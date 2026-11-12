import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { CaseError, hash } from '../copilot/m3/workflow.mjs';
import { inspectPatentPDFPack } from '../patents/intake.mjs';
import { parsePilotLock, pilotLockDigest } from '../patents/pilot-lock.mjs';
import { createPatentService } from '../patents/service.mjs';
import { openPatentStore } from '../patents/store.mjs';
import { buildPatentPrompt } from '../patents/workflow.mjs';

const reviewer = { name: 'binh', role: 'reviewer', group: 'nhan-hieu' };
const peer = { ...reviewer, name: 'another-reviewer' };
const prefix = '/api/patents';
const call = (service, path, body, actor = reviewer) =>
  service.handle({ method: body === undefined ? 'GET' : 'POST' }, prefix + path, actor, async () => body);
const roles = ['notice', 'claim', 'd1'];
const real = { synthetic: false, anonymized: true };
const reference = 'PRIVATE-TRIAL';
const asOf = '2026-11-11';

function syntheticD1() {
  const lines = ['The drive enables a signal.\nA local LED illuminates.', 'A metal housing covers the drive.'];
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Count 2 /Kids [3 0 R 4 0 R] >>',
    ...[6, 7].map(index => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Resources << /Font << /F 5 0 R >> >> /Contents ${index} 0 R >>`),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', ...lines.map(text => {
      const body = 'BT /F 12 Tf 30 120 Td ' + text.split('\n').map(line => '(' + line + ') Tj').join(' 0 -20 Td ') + ' ET';
      return `<< /Length ${body.length} >>\nstream\n${body}\nendstream`;
    })];
  let pdf = '%PDF-1.7\n';
  const offsets = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  return Buffer.from(pdf + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}

function select(document, { text: pageText, page }, excerpt = pageText.split('\n').find(line => line.trim().length >= 10).trim()) {
  const start = pageText.indexOf(excerpt);
  assert.ok(start >= 0);
  return { ...document, label: 'Tài liệu pilot ' + document.role, page, start, end: start + excerpt.length, text: excerpt, confirmed: true };
}

test('strict lock rejects legacy configuration, unknown fields and invalid anchors', () => {
  const sources = Object.fromEntries(roles.map((role, index) => [role,
    { sha256: String(index + 1).repeat(64), page: 1, start: 0, end: 10, textSha256: hash(role) }]));
  const lock = { version: 1, manifestSha256: hash('manifest'), reference, asOf, sources };
  assert.deepEqual(parsePilotLock(JSON.stringify(lock)), lock);
  assert.equal(pilotLockDigest(lock), pilotLockDigest({ ...lock, sources: { d1: sources.d1, claim: sources.claim, notice: sources.notice } }));
  const replacements = [{ page: 13 }, { page: 0 }, { start: 1.5 }, { start: -1 }, { end: 0 }, { end: 1801 },
    { start: 300000, end: 300010 }, { sha256: 'A'.repeat(64) }, { sha256: sources.claim.sha256 }, { text: 'confidential' }, { path: 'private.pdf' }];
  for (const value of [undefined, '{malformed', Object.fromEntries(roles.map(role => [role, sources[role].sha256])),
    { ...lock, version: 2 }, { ...lock, manifestSha256: 'wrong' }, { ...lock, reference: 'private-trial' },
    { ...lock, reference: reference + ' ' }, { ...lock, asOf: '2026-02-31' }, { ...lock, phase2: 'private instruction' },
    ...replacements.map(change => ({ ...lock, sources: { ...sources, d1: { ...sources.d1, ...change } } }))]) {
    assert.throws(() => parsePilotLock(value), /khóa nguồn pilot/u);
  }
});

test('private import checks actual PDF bytes plus the Word reserve and exact replay writes no storage', t => {
  const store = openPatentStore(':memory:');
  t.after(store.close);
  const locked = (id, ref) => ({ id, group: '@patent-pilot:' + hash(id), reference: ref, title: ref,
    version: 1, updatedAt: asOf, synthetic: false, pilotLockSha256: hash(id),
    pilotManifestSha256: hash(ref), pilotImportSha256: hash('initial ' + ref) });
  const attachment = (id, bytes) => ({ id, bytes, sha256: hash(bytes), pageCount: 1 });
  const original = locked('original', 'FIRST');
  const originalPDF = Buffer.alloc(20 * 1024);
  store.create(original, { attachments: [attachment('original-pdf', originalPDF)] });
  const filler = Buffer.alloc((6 * 1024 - 512) * 1024 - originalPDF.length - 1);
  store.create({ ...locked('filler', 'FILLER'), synthetic: true, group: 'test', pilotLockSha256: undefined },
    { attachments: [attachment('filler-pdf', filler)] });
  const another = locked('another', 'SECOND');
  assert.throws(() => store.create(another, { attachments: [attachment('next-pdf', Buffer.alloc(2))] }), { status: 413 });
  assert.deepEqual(store.list(another.group), []);
  assert.deepEqual(store.create({ ...original, id: 'replayed' }, { attachments: [attachment('replayed-pdf', originalPDF)] }), original);
  assert.equal(store.findAttachment(original.id, original.group, hash(originalPDF)), 'original-pdf');
});

test('anonymized patent pilot pins one approved PDF pack to a private owner and preserves two reviewed releases', async t => {
  mkdirSync('work', { recursive: true });
  const directory = mkdtempSync(resolve('work/patent-anonymized-pilot-'));
  const storePath = resolve(directory, 'case.sqlite');
  const files = Object.fromEntries(roles.map((role, index) => [role,
    role === 'd1' ? syntheticD1() : readFileSync(new URL('../distribution/demo/DT-DEMO-0' + (index + 1) + '.pdf', import.meta.url))]));
  const approvedHashes = Object.fromEntries(roles.map(role => [role, hash(files[role])]));
  const documents = roles.map(role => ({ role, content: files[role].toString('base64') }));
  const { documents: extracted } = await inspectPatentPDFPack({ synthetic: true,
    documents: documents.map(item => ({ ...item, firstPage: 1, lastPage: item.role === 'd1' ? 2 : 1 })) });
  const selections = extracted.map(({ role, pages, sha256 }, index) => select({ ...documents[index], sha256 }, pages[0]));
  const lock = { version: 1, manifestSha256: hash('test pilot manifest'), reference, asOf,
    sources: Object.fromEntries(selections.map(({ role, sha256, page, start, end, text }) => [role,
      { sha256, page, start, end, textSha256: hash(text) }])) };
  const approvedPilot = JSON.stringify(lock);
  const lockDigest = pilotLockDigest(lock);
  const bundle = { ...real, documents };
  let modelCalls = 0;
  let acceptModel = true;
  const modelInputs = [];
  const service = createPatentService({ storePath, approvedPilot, model: async ({ matter, targets }) => {
    modelCalls++;
    modelInputs.push({ documents: structuredClone(matter.documents), instructionsText: matter.instructionsText, targets });
    assert.equal(matter.pilotLockSha256, lockDigest);
    const prompt = buildPatentPrompt({ matter, targets }, { model: 'test', remote: false });
    assert.match(prompt.messages[0].content, /Hồ sơ đã ẩn danh/);
    assert.match(prompt.messages[1].content, /Chỉ dẫn nghiệp vụ của pilot ẩn danh/);
    if (!acceptModel) throw new CaseError('Model tạm thời không phản hồi.', 503);
    const rows = [{ feature: 'Dấu hiệu đang đối chiếu', claimQuote: matter.claimText,
      d1Quote: selections[2].text, d1RecordId: matter.d1RecordIds[0], assessment: 'uncertain',
      analysis: 'Đoạn đã chọn cần kiểm thêm.', missing: 'Cần rà nguồn.' }];
    return { patch: { ...(targets.includes('matrix') ? { matrix: { rows } } : {}),
      response: { text: 'Kiểm tra kích thước và vị trí theo đoạn đã chọn.', evidenceIds: matter.evidenceIds } },
    run: { model: 'test', outcome: 'accepted' } };
  } });
  const disabled = createPatentService({ storePath, approvedPilot: '{malformed' });
  const legacy = createPatentService({ storePath, approvedPilot: JSON.stringify(approvedHashes) });
  const otherLock = { ...lock, manifestSha256: hash('different manifest') };
  const changed = createPatentService({ storePath, approvedPilot: JSON.stringify(otherLock) });
  const legacyStore = openPatentStore(storePath);
  const db = new DatabaseSync(storePath);
  t.after(() => {
    for (const resource of [service, disabled, legacy, changed, legacyStore, db]) resource.close();
    rmSync(directory, { recursive: true, force: true });
  });

  assert.equal((await call(disabled, '/status')).value.anonymizedPilot, undefined);
  assert.equal((await call(disabled, '/pdf-pack/inspect', bundle)).status, 403);
  assert.equal((await call(legacy, '/pdf-pack/inspect', bundle)).status, 403);
  assert.equal((await call(service, '/status', undefined, peer)).value.anonymizedPilot, undefined);
  assert.equal((await call(service, '/status', undefined, peer)).value.pilotSourceLock, undefined);
  assert.equal((await call(service, '/status', undefined, { ...reviewer, role: 'editor' })).value.anonymizedPilot, undefined);
  assert.equal((await call(service, '/status')).value.anonymizedPilot, true);
  assert.equal((await call(service, '/status')).value.responseRevision, true);
  assert.deepEqual((await call(service, '/status')).value.pilotSourceLock, { reference, asOf });
  assert.equal((await call(service, '/pdf-pack/inspect', bundle, null)).status, 401);
  assert.equal((await call(service, '/pdf-pack/inspect', bundle, peer)).status, 403);
  assert.equal((await call(service, '/pdf-pack/inspect', { synthetic: true, documents })).status, 422);
  assert.equal((await call(service, '/pdf-pack/inspect', { ...bundle, documents: [
    { ...documents[0], content: documents[1].content }, ...documents.slice(1)
  ] })).status, 422);
  const inspected = (await call(service, '/pdf-pack/inspect', bundle)).value;
  assert.deepEqual(inspected.locked, { reference, asOf, sources: lock.sources });
  assert.equal(inspected.documents[2].pageCount, 2);
  assert.deepEqual(inspected.documents[2].pages.map(item => item.page), [1]);
  assert.equal((await call(service, '/pdf-pack/inspect', { ...bundle, documents: [documents[0], documents[1],
    { ...documents[2], firstPage: 2, lastPage: 2 }] })).status, 422);
  const { role, content, sha256, page } = selections[2];
  const preview = { ...real, role, content, sha256, page };
  assert.equal((await call(service, '/pdf-pack/preview', preview, peer)).status, 403);
  assert.equal((await call(service, '/pdf-pack/preview', { ...preview, role: 'claim' })).status, 422);
  assert.equal((await call(service, '/pdf-pack/preview', { ...preview, page: 2 })).status, 422);
  assert.equal((await call(service, '/pdf-pack/preview', preview)).headers['X-Source-SHA256'], sha256);
  const create = { ...real, documents: selections, reference, title: 'Hồ sơ kiểm thử ẩn danh',
    jurisdiction: 'VN', asOf, instructionsText: 'Đọc đúng đoạn đã gắn.' };
  assert.equal((await call(service, '/cases/pdf-pack', create, peer)).status, 403);
  assert.equal((await call(service, '/cases', create)).status, 422);
  const [firstPage, secondPage] = extracted[2].pages;
  const wrongQuote = select({ ...documents[2], sha256 }, firstPage, 'A local LED illuminates.');
  const wrongPage = select({ ...documents[2], sha256 }, secondPage);
  for (const alternative of [wrongQuote, wrongPage, { ...selections[2], textSha256: hash('wrong') }]) {
    assert.equal((await call(service, '/cases/pdf-pack', { ...create, documents: [...selections.slice(0, 2), alternative] })).status, 422);
  }
  assert.deepEqual((await call(service, '/cases')).value, []);
  const imports = await Promise.all([call(service, '/cases/pdf-pack', create), call(service, '/cases/pdf-pack', create)]);
  assert.deepEqual(imports.map(item => item.status).sort(), [200, 201]);
  const created = imports.find(item => item.status === 201);
  assert.deepEqual(imports.find(item => item.status === 200).value, created.value);
  let matter = created.value;
  const path = '/cases/' + matter.id;
  assert.deepEqual([matter.synthetic, matter.anonymized], [false, true]);
  assert.equal(matter.pilotLockSha256, lockDigest);
  assert.equal(matter.group, '@patent-pilot:' + lockDigest);
  assert.deepEqual(legacyStore.list(reviewer.group), []);
  assert.equal((await call(service, '/cases')).value.length, 1);
  assert.deepEqual((await call(service, '/cases', undefined, peer)).value, []);
  assert.deepEqual((await call(disabled, '/cases')).value, []);
  assert.deepEqual((await call(changed, '/cases')).value, []);
  assert.equal((await call(changed, '/cases/pdf-pack', create)).status, 409);
  assert.equal((await call(service, '/cases/pdf-pack', { ...create, reference: 'SECOND-PACK' })).status, 409);
  assert.equal((await call(service, '/cases/pdf-pack', { ...create, asOf: '2026-11-12' })).status, 409);
  assert.equal((await call(service, '/cases/pdf-pack', { ...create, title: 'Changed title' })).status, 409);
  assert.equal((await call(service, '/cases/pdf-pack', { ...create, instructionsText: 'Changed instructions' })).status, 409);
  assert.equal((await call(service, '/cases/pdf-pack', { ...create, documents: [...selections.slice(0, 2),
    { ...selections[2], label: 'Changed D1 label' }] })).status, 409);
  assert.equal((await call(service, path, undefined, peer)).status, 404);
  assert.equal((await call(disabled, path)).status, 404);
  for (const document of matter.documents) {
    assert.deepEqual((await call(service, document.openUrl.slice(prefix.length))).value, files[document.role]);
    assert.equal((await call(service, document.openUrl.slice(prefix.length), undefined, peer)).status, 404);
    assert.equal((await call(service, document.pageUrl.slice(prefix.length), undefined, peer)).status, 404);
    assert.equal((await call(disabled, document.openUrl.slice(prefix.length))).status, 404);
  }
  const d1Page = matter.documents.find(item => item.role === 'd1').pageUrl.slice(prefix.length);
  assert.equal((await call(service, d1Page.replace(/1$/, '2'))).status, 422);
  assert.equal((await call(service, path + '/pdf/bind', { version: matter.version })).status, 422);
  assert.equal((await call(service, path + '/source', { version: matter.version, evidenceIds: [],
    instructionsText: 'Đổi nguồn.' })).status, 422);
  assert.equal((await call(service, path + '/propose', { version: matter.version, targets: ['response'] }, peer)).status, 404);
  assert.equal((await call(disabled, path + '/propose', { version: matter.version, targets: ['response'] })).status, 404);
  assert.equal((await call(service, path + '/propose', { version: matter.version, targets: ['response'], instructionsText: 'Bản mới.' })).status, 422);
  assert.equal((await call(service, path + '/propose', { version: matter.version, targets: ['response'], page: 2 })).status, 422);
  async function rejectChangedSavedCase(change, request) {
    const { content } = db.prepare('SELECT content FROM patent_cases WHERE id=?').get(matter.id);
    const corrupted = JSON.parse(content);
    change(corrupted);
    const write = db.prepare('UPDATE patent_cases SET content=? WHERE id=?');
    write.run(JSON.stringify(corrupted), matter.id);
    try { assert.equal((await call(service, path + '/propose', request)).status, 409); }
    finally { write.run(content, matter.id); }
  }
  const firstProposal = { version: matter.version, targets: ['matrix', 'response'] };
  await rejectChangedSavedCase(saved => { saved.documents[2].page = 2; }, firstProposal);
  await rejectChangedSavedCase(saved => { saved.documents[2].start++; }, firstProposal);
  await rejectChangedSavedCase(saved => { saved.pinnedEvidence[1].record.text = wrongQuote.text; }, firstProposal);
  const pdfAttachment = matter.documents.find(item => item.role === 'd1').attachmentId;
  const writePDF = db.prepare('UPDATE patent_pdf_attachments SET bytes=? WHERE id=?');
  const corruptedPDF = Buffer.from(files.d1);
  corruptedPDF[0] ^= 1;
  writePDF.run(corruptedPDF, pdfAttachment);
  try { assert.equal((await call(service, path + '/propose', firstProposal)).status, 409); }
  finally { writePDF.run(files.d1, pdfAttachment); }
  assert.equal(modelCalls, 0);
  matter = (await call(service, path + '/propose', firstProposal)).value;
  assert.equal(matter.proposals.at(-1).run.pilotLockSha256, lockDigest);
  matter = (await call(service, path + '/approve', { version: matter.version, targets: ['matrix'], reviewed: true })).value;
  assert.equal(matter.releases.length, 0);
  matter = (await call(service, path + '/approve', { version: matter.version, targets: ['response'], reviewed: true })).value;
  assert.equal(matter.releases.length, 1);
  const matrix = structuredClone(matter.sections.matrix);
  assert.equal(matter.releases[0].pilotLockSha256, lockDigest);
  assert.deepEqual(await call(service, '/cases/pdf-pack', create), { status: 200, value: matter });
  const word1 = (await call(service, path + '/word/1')).value;
  assert.ok(word1.includes(Buffer.from('Hồ sơ đã ẩn danh')));
  assert.equal((await call(service, path + '/word/1', undefined, peer)).status, 404);
  assert.equal((await call(disabled, path + '/word/1')).status, 404);

  const revision = { version: matter.version, targets: ['response'], instructionsText: 'Chỉ rõ cách kiểm tra kích thước.' };
  assert.equal((await call(service, path + '/propose', { ...revision, targets: ['matrix'] })).status, 422);
  assert.equal((await call(service, path + '/edit', { version: matter.version, matrixRows: matrix.rows })).status, 422);
  await rejectChangedSavedCase(saved => { saved.documents[2].textSha256 = hash(wrongQuote.text); }, revision);
  await rejectChangedSavedCase(saved => { saved.sections.matrix.rows[0].feature += '!'; }, revision);
  const writeWord = db.prepare('UPDATE patent_word_artifacts SET bytes=? WHERE case_id=? AND release_number=1');
  const corruptedWord = Buffer.from(word1);
  corruptedWord[0] ^= 1;
  writeWord.run(corruptedWord, matter.id);
  try { assert.equal((await call(service, path + '/propose', revision)).status, 409); }
  finally { writeWord.run(word1, matter.id); }
  assert.equal(modelCalls, 1);
  acceptModel = false;
  assert.equal((await call(service, path + '/propose', revision)).status, 503);
  const unchanged = (await call(service, path)).value;
  assert.equal(unchanged.version, matter.version);
  assert.equal(unchanged.instructionsText, matter.instructionsText);
  assert.equal(unchanged.sections.response.approval.sha256, matter.sections.response.approval.sha256);
  assert.deepEqual((await call(service, path + '/word/1')).value, word1);
  acceptModel = true;
  matter = (await call(service, path + '/propose', revision)).value;
  assert.equal(matter.version, unchanged.version + 1);
  assert.equal(modelInputs.at(-1).instructionsText, revision.instructionsText);
  assert.deepEqual(modelInputs.at(-1).documents, modelInputs[0].documents);
  assert.deepEqual(modelInputs.at(-1).targets, ['response']);
  assert.equal(matter.instructionsText, revision.instructionsText);
  assert.deepEqual(matter.sections.matrix, matrix);
  assert.equal(matter.sections.response.approval, null);
  matter = (await call(service, path + '/approve', { version: matter.version, targets: ['response'], reviewed: true })).value;
  assert.equal(matter.releases.length, 2);
  assert.equal(matter.releases[1].synthetic, false);
  assert.equal(matter.releases[1].anonymized, true);
  assert.equal(matter.releases[1].pilotLockSha256, lockDigest);
  assert.deepEqual(matter.releases[1].sections.matrix, matter.releases[0].sections.matrix);
  assert.deepEqual(await call(service, '/cases/pdf-pack', create), { status: 200, value: matter });
  assert.equal((await call(service, '/cases')).value.length, 1);
  assert.equal(db.prepare('SELECT count(*) AS count FROM patent_pdf_attachments').get().count, 3);
  assert.deepEqual((await call(service, path + '/word/1')).value, word1);
  assert.notDeepEqual((await call(service, path + '/word/2')).value, word1);
  assert.equal((await call(service, path + '/propose', { ...revision, version: matter.version })).status, 409);
  assert.equal(modelCalls, 3);
});
