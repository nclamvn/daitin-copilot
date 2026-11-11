import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { hash } from '../copilot/m3/workflow.mjs';
import { openPatentStore } from '../patents/store.mjs';
import { createPatentWorkflow, buildPatentPrompt, generatePatentProposal } from '../patents/workflow.mjs';
import { DatabaseSync } from 'node:sqlite';
import { loadDataset } from '../patents/dataset.mjs';

// These are synthetic protocol fixtures, not entries in the public legal corpus.
const claim = 'A vessel comprising a first label and a removable second label.';
const d1 = 'A bottle has a removable label fixed to a container body.';
const lawyer = { name: 'reviewer', role: 'reviewer', group: 'patent-team' };
const editor = { name: 'editor', role: 'editor', group: 'patent-team' };
const other = { name: 'other', role: 'reviewer', group: 'another-team' };
const dataset = {
  status: 'candidate', builtAt: '2026-11-11T00:00:00Z', digest: 'fixture-digest',
  sources: [
    { id: 'target-source', title: 'Target fixture', kind: 'patent', authority: 'Unit fixture', url: 'https://example.test/target', sha256: hash(claim) },
    { id: 'd1-source', title: 'D1 fixture', kind: 'patent', authority: 'Unit fixture', url: 'https://example.test/d1', sha256: hash(d1) },
    { id: 'law-source', title: 'Law fixture', kind: 'law', authority: 'Unit fixture', url: 'https://example.test/law', sha256: hash('Điều 1. Quy định mô phỏng.') }
  ], records: [
    { id: 'target-claim-1', sourceId: 'target-source', kind: 'patent', title: 'Target claim1 fixture', text: claim, locator: { label: 'Claim 1', section: 'claim' }, jurisdiction: 'EP', provenance: 'assistant_proposed' },
    { id: 'd1-paragraph', sourceId: 'd1-source', kind: 'patent', title: 'D1 paragraph fixture', text: d1, locator: { label: 'Paragraph 1' }, jurisdiction: 'US', provenance: 'assistant_proposed' },
    { id: 'law-article-1', sourceId: 'law-source', kind: 'law', title: 'Law article fixture', text: 'Điều 1. Quy định mô phỏng.', locator: { label: 'Điều 1' }, jurisdiction: 'VN', provenance: 'assistant_proposed' }
  ]
};
const row = { id: 'feature-1', feature: 'Nhãn có thể tháo', claimQuote: 'a removable second label', d1RecordId: 'd1-paragraph',
  d1Quote: 'a removable label', assessment: 'uncertain', analysis: 'Hai đoạn đề cập nhãn tháo rời, cần kiểm tra cấu trúc và cách gắn.', missing: 'Chưa đối chiếu toàn bộ bản mô tả.' };
const response = { text: 'Dự thảo nội bộ: đề nghị rà soát cấu trúc nhãn và bổ sung đối chiếu toàn bộ D1 trước khi chốt lập luận.',
  evidenceIds: ['d1-paragraph', 'case:notice', 'case:instructions'] };
const body = { synthetic: true, reference: 'PAT-TEST-01', title: 'Hồ sơ kiểm giao thức', claimText: claim,
  claimRecordId: 'target-claim-1', d1RecordIds: ['d1-paragraph'], evidenceIds: ['target-claim-1', 'd1-paragraph', 'law-article-1'],
  claimVersion: 'public-claim-v1', jurisdiction: 'VN', asOf: '2026-11-11',
  noticeText: 'THÔNG BÁO MÔ PHỎNG: đề nghị đối chiếu cấu trúc nhãn với D1.',
  instructionsText: 'CHỈ DẪN MÔ PHỎNG: soạn dự thảo nội bộ, chưa khẳng định tính mới.' };
function setup(t, model) {
  mkdirSync(resolve('work'), { recursive: true });
  const directory = mkdtempSync(resolve('work/patent-workflow-'));
  const store = openPatentStore(resolve(directory, 'cases.sqlite'));
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  return { directory, store, workflow: createPatentWorkflow(store, dataset, model) };
}
function documentXML(bytes) {
  let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    const size = bytes.readUInt32LE(offset + 18), filenameLength = bytes.readUInt16LE(offset + 26), extra = bytes.readUInt16LE(offset + 28);
    const name = bytes.subarray(offset + 30, offset + 30 + filenameLength).toString();
    const start = offset + 30 + filenameLength + extra;
    if (name === 'word/document.xml') return bytes.subarray(start, start + size).toString();
    offset = start + size;
  }
  throw new Error('No Word document XML');
}
function savedWord(store, workflow, caseId, number) {
  return store.wordArtifact(caseId, lawyer.group, workflow.release(caseId, number, lawyer));
}

test('patent workflow enforces group, version, explicit D1 roles and exact claim/D1 quotes', t => {
  const { workflow } = setup(t);
  const matter = workflow.create(body, editor);
  assert.throws(() => workflow.read(matter.id, other), { status: 404 });
  assert.throws(() => workflow.edit(matter.id, { version: 0, matrixRows: [row] }, editor), { status: 409 });
  assert.throws(() => workflow.create({ ...body, reference: 'PAT-BAD-D1', d1RecordIds: ['law-article-1'] }, editor), { status: 422 });
  assert.throws(() => workflow.create({ ...body, reference: 'PAT-NONCLAIM', claimRecordId: 'd1-paragraph', claimText: d1 }, editor), { status: 422 });
  assert.throws(() => workflow.create({ ...body, reference: 'PAT-SELF', d1RecordIds: ['target-claim-1'] }, editor), { status: 422 });
  assert.throws(() => workflow.edit(matter.id, { version: matter.version, matrixRows: [{ ...row, d1RecordId: 'law-article-1', d1Quote: 'Điều 1.' }] }, editor), { status: 422 });
  assert.throws(() => workflow.edit(matter.id, { version: matter.version, matrixRows: [{ ...row, d1Quote: 'invented feature' }] }, editor), { status: 422 });
  assert.throws(() => workflow.edit(matter.id, { version: matter.version, matrixRows: [{ ...row, claimQuote: 'invented claim' }] }, editor), { status: 422 });
  assert.throws(() => workflow.edit(matter.id, { version: matter.version, response: { ...response, evidenceIds: ['not-selected'] } }, editor), { status: 422 });
});

test('patent workflow distinguishes explicit missing evidence from facts and never exports an unapproved draft', t => {
  const { store, workflow } = setup(t);
  let matter = workflow.create(body, editor);
  const missing = { ...row, d1RecordId: null, d1Quote: '', assessment: 'not_found', missing: 'Cần đọc toàn bộ D1.' };
  matter = workflow.edit(matter.id, { version: matter.version, matrixRows: [row, missing], response }, editor);
  assert.equal(matter.sections.matrix.rows[1].d1RecordId, null);
  assert.throws(() => workflow.release(matter.id, 1, lawyer), { status: 404 });
  assert.throws(() => workflow.approve(matter.id, { version: matter.version, targets: ['matrix'] }, editor), { status: 403 });
  matter = workflow.approve(matter.id, { version: matter.version, targets: ['matrix'] }, lawyer);
  assert.equal(matter.releases.length, 0);
  matter = workflow.approve(matter.id, { version: matter.version, targets: ['response'] }, lawyer);
  const release = workflow.release(matter.id, 1, lawyer);
  assert.equal(release.privateEvidence.find(item => item.id === 'case:notice').text, body.noticeText);
  const bytes = savedWord(store, workflow, matter.id, 1);
  assert.deepEqual(release.artifact, { sha256: hash(bytes), byteLength: bytes.length });
  const xml = documentXML(bytes).replaceAll('\u00a0', ' ');
  assert.ok(xml.includes('Phân tích hồ sơ sáng chế'));
  assert.ok(xml.includes('Đối chiếu từng đặc điểm'));
  assert.ok(xml.includes('D1 fixture'));
  assert.equal(xml.includes('thẩm định nhãn hiệu'), false);
  assert.equal(xml.includes('\u2014'), false);
  assert.ok(matter.releases.length === 1);
});

test('second-session private instructions invalidate response only and preserve immutable approved Word1', t => {
  const { store, workflow } = setup(t);
  let matter = workflow.create(body, editor);
  matter = workflow.edit(matter.id, { version: matter.version, matrixRows: [row], response }, editor);
  matter = workflow.approve(matter.id, { version: matter.version, targets: ['matrix', 'response'] }, lawyer);
  const before = hash(savedWord(store, workflow, matter.id, 1));
  const matrixApproval = structuredClone(matter.sections.matrix.approval);
  matter = workflow.source(matter.id, { version: matter.version, evidenceIds: matter.evidenceIds,
    instructionsText: 'CHỈ DẪN MÔ PHỎNG PHIÊN HAI: nhấn mạnh phần cần kiểm chứng.' }, editor);
  assert.deepEqual(matter.sections.matrix.approval, matrixApproval);
  assert.equal(matter.sections.response.approval, null);
  matter = workflow.edit(matter.id, { version: matter.version, response: { ...response, text: response.text + ' Cần kiểm chứng thêm trước khi sử dụng.' } }, editor);
  matter = workflow.approve(matter.id, { version: matter.version, targets: ['response'] }, lawyer);
  assert.equal(matter.releases.length, 2);
  assert.deepEqual(matter.releases[0].sections.matrix, matter.releases[1].sections.matrix);
  assert.equal(hash(savedWord(store, workflow, matter.id, 1)), before);
  assert.notEqual(hash(savedWord(store, workflow, matter.id, 2)), before);
});

test('an AI response requires review against its matrix revision and preserves the earlier Word after changes', async t => {
  const { directory, store, workflow } = setup(t, async () => ({ patch: { matrix: { rows: [row] }, response } }));
  let matter = workflow.create(body, editor);
  matter = await workflow.propose(matter.id, { version: matter.version, targets: ['matrix', 'response'] }, editor);
  assert.equal(matter.sections.matrix.reviewRequired, true);
  assert.equal(matter.sections.response.reviewRequired, true);
  assert.equal(matter.sections.response.matrixBasisChanged, false);
  assert.throws(() => workflow.approve(matter.id, { version: matter.version, targets: ['matrix'] }, lawyer), { status: 422 });
  matter = workflow.approve(matter.id, { version: matter.version, targets: ['matrix', 'response'], reviewed: true }, lawyer);
  const word = savedWord(store, workflow, matter.id, 1);
  matter = workflow.edit(matter.id, { version: matter.version, matrixRows: [{ ...row, analysis: 'Đã đổi nhận định đối chiếu.' }] }, editor);
  assert.equal(matter.sections.response.matrixBasisChanged, true);
  assert.equal(matter.sections.response.approval, null);
  assert.throws(() => workflow.approve(matter.id, { version: matter.version, targets: ['response'], reviewed: true }, lawyer), { status: 422 });
  matter = workflow.edit(matter.id, { version: matter.version, response }, editor);
  assert.equal(matter.sections.response.matrixBasisChanged, false);
  matter = workflow.approve(matter.id, { version: matter.version, targets: ['matrix', 'response'], reviewed: true }, lawyer);
  assert.equal(matter.releases.length, 2);
  assert.deepEqual(savedWord(store, workflow, matter.id, 1), word);
  assert.notDeepEqual(savedWord(store, workflow, matter.id, 2), word);
  const db = new DatabaseSync(resolve(directory, 'cases.sqlite'));
  db.prepare('UPDATE patent_word_artifacts SET bytes = ? WHERE case_id = ? AND release_number = 1').run(Buffer.alloc(word.length), matter.id);
  db.close();
  assert.throws(() => savedWord(store, workflow, matter.id, 1), { status: 409 });
});

test('changed public source requires repinning, updates dataset receipt and cannot alter old release export', t => {
  const { store, workflow } = setup(t);
  let matter = workflow.create(body, editor);
  matter = workflow.edit(matter.id, { version: matter.version, matrixRows: [row], response }, editor);
  matter = workflow.approve(matter.id, { version: matter.version, targets: ['matrix', 'response'] }, lawyer);
  const before = hash(savedWord(store, workflow, matter.id, 1));
  const changed = structuredClone(dataset); changed.digest = 'new-fixture-digest'; changed.sources[1].sha256 = hash('changed raw source');
  const next = createPatentWorkflow(store, changed);
  assert.equal(next.read(matter.id, lawyer).sourceChanged, true);
  assert.throws(() => next.approve(matter.id, { version: matter.version, targets: ['response'] }, lawyer), { status: 409 });
  matter = next.source(matter.id, { version: matter.version, evidenceIds: matter.evidenceIds }, lawyer);
  assert.equal(matter.datasetDigest, 'new-fixture-digest');
  assert.equal(matter.sections.matrix.approval, null);
  assert.equal(matter.sections.response.approval, null);
  assert.equal(hash(savedWord(store, next, matter.id, 1)), before);
});

test('patent prompt uses explicit D1 and private input hashes, validates model source IDs, never calls when context missing', async t => {
  const { workflow } = setup(t);
  const matter = workflow.create(body, editor);
  const connection = { model: 'fixture-model', provider: 'fixture', endpoint: 'https://fixture.test/chat/completions', remote: true, credential: async () => 'fake-private-key' };
  const input = { matter, targets: ['matrix', 'response'], instruction: 'Lập đối chiếu mô phỏng.' };
  const prompt = buildPatentPrompt(input, connection);
  assert.equal(prompt.max_tokens, 1800);
  const options = JSON.parse(prompt.messages[1].content).spanOptions;
  const schemaD1 = prompt.response_format.json_schema.schema.properties.matrix.properties.rows.items.properties.d1SpanId.enum;
  assert.deepEqual(schemaD1, [...options.d1.map(item => item.id), null]);
  assert.ok(prompt.messages[1].content.includes('case:notice'));
  assert.equal(prompt.messages.some(item => item.content.includes('fake-private-key')), false);
  let calls = 0;
  const modelRow = { feature: row.feature, claimSpanId: options.claim[0].id, d1SpanId: options.d1[0].id,
    assessment: 'disclosed', analysis: row.analysis, missing: '' };
  const fetcher = async () => { calls++; return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ matrix: { rows: [modelRow] }, response }) } }],
    usage: { prompt_tokens: 200, completion_tokens: 100 } }); };
  const result = await generatePatentProposal(input, { connection, fetcher });
  assert.equal(calls, 1);
  assert.equal(result.run.provenance, 'model_inference');
  assert.equal(result.patch.matrix.rows[0].d1Quote, d1);
  assert.equal(result.patch.matrix.rows[0].assessment, 'uncertain');
  assert.match(result.patch.matrix.rows[0].missing, /Luật sư cần kiểm/);
  assert.equal(result.run.quoteMethod, 'deterministic_native_span_ids');
  assert.equal(result.run.selectedSpans[0].d1.recordSHA256, hash(d1));
  assert.ok(result.run.inputEvidenceHashes.some(item => item.id === 'case:notice'));
  await assert.rejects(() => generatePatentProposal({ ...input, matter: { ...matter, noticeText: '' } }, { connection, fetcher }), { status: 422 });
  assert.equal(calls, 1);
  const badFetcher = async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ response: { text: 'Text', evidenceIds: ['invented-id'] } }) } }] });
  await assert.rejects(() => generatePatentProposal({ ...input, targets: ['response'] }, { connection, fetcher: badFetcher }), { status: 422 });
});

 test('known damaged extraction blocks AI and approval while generic unreviewed OCR remains visibly labeled', async t => {
  const { store } = setup(t);
  const damaged = structuredClone(dataset); damaged.sources[1].knownExtractionWarning = 'Known technical unit OCR error.';
  const guarded = createPatentWorkflow(store, damaged);
  let matter = guarded.create({ ...body, reference: 'DAMAGED-OCR' }, editor);
  assert.throws(() => buildPatentPrompt({ matter, targets: ['matrix'] }, { model: 'fixture' }), { status: 422 });
  matter = guarded.edit(matter.id, { version: matter.version, matrixRows: [row] }, editor);
  assert.throws(() => guarded.approve(matter.id, { version: matter.version, targets: ['matrix'] }, lawyer), { status: 422 });
  const generic = structuredClone(dataset); generic.records[1].textFidelity = 'ocr_unreviewed';
  generic.sources[1].requiresOriginalCheck = true; generic.sources[1].extractionWarnings = ['OCR not human reviewed'];
  const usable = createPatentWorkflow(store, generic).create({ ...body, reference: 'GENERIC-OCR' }, editor);
  const prompt = buildPatentPrompt({ matter: usable, targets: ['matrix'] }, { model: 'fixture' });
  assert.match(prompt.messages[0].content, /UNVERIFIED_TRANSCRIPTION/);
  assert.equal(JSON.parse(prompt.messages[1].content).evidence[1].requiresOriginalCheck, true);
});

 test('D1 cannot be another claim or cloned source from the same explicit publication', t => {
  const { store } = setup(t);
  const samePublication = structuredClone(dataset);
  samePublication.sources[0].publicationIdentifier = 'EP1004359B1';
  samePublication.sources.push({ ...samePublication.sources[0], id: 'cloned-target-source', publicationIdentifier: 'EP 1 004 359 B1' });
  samePublication.records.push(
    { ...samePublication.records[0], id: 'target-claim-2', text: 'The vessel of claim1 further comprises a lid.' },
    { ...samePublication.records[0], id: 'cloned-claim-2', sourceId: 'cloned-target-source', text: 'A second claim from the identical publication.' }
  );
  const workflow = createPatentWorkflow(store, samePublication);
  for (const id of ['target-claim-2', 'cloned-claim-2']) {
    assert.throws(() => workflow.create({ ...body, reference: 'SAME-' + id.toUpperCase(),
      evidenceIds: [...body.evidenceIds, id], d1RecordIds: [id] }, editor), { status: 422 });
  }
  // Manual text has no asserted publication identity. The operator must select
  // its role explicitly; the application does not guess a publication/family.
  const manual = workflow.create({ ...body, reference: 'MANUAL-IDENTITY', claimRecordId: null,
    evidenceIds: [...body.evidenceIds, 'target-claim-2'], d1RecordIds: ['target-claim-2'] }, editor);
  assert.equal(manual.claimRecordId, null);
  assert.deepEqual(manual.d1RecordIds, ['target-claim-2']);
  const legacy = store.save({ ...manual, claimRecordId: 'target-claim-1' });
  assert.throws(() => workflow.edit(legacy.id, { version: legacy.version, response }, editor), { status: 422 });
  assert.throws(() => workflow.approve(legacy.id, { version: legacy.version, targets: ['matrix'] }, lawyer), { status: 422 });
});

 test('actual dependent claim auto-pins literal parent, blocks incomplete legacy context and quotes inherited features explicitly', async t => {
  const { store } = setup(t);
  const actual = loadDataset();
  const target = actual.records.find(item => item.id === 'ep-ep1004359b1-claim-2');
  const parent = actual.records.find(item => item.id === 'ep-ep1004359b1-claim-1');
  const cited = actual.records.find(item => item.id === 'us-patent-5783810-page-7-1');
  let modelCalls = 0;
  const workflow = createPatentWorkflow(store, actual, async () => { modelCalls++; throw new Error('must not call'); });
  let matter = workflow.create({ ...body, reference: 'ACTUAL-DEPENDENT', claimText: target.text, claimRecordId: target.id,
    claimVersion: target.id, evidenceIds: [target.id, cited.id], d1RecordIds: [cited.id] }, editor);
  assert.ok(matter.evidenceIds.includes(parent.id));
  assert.deepEqual(matter.derivedContextRecordIds, [parent.id]);
  const prompt = buildPatentPrompt({ matter, targets: ['matrix'] }, { model: 'test-no-call' });
  const input = JSON.parse(prompt.messages[1].content);
  assert.deepEqual(input.claimContext.inheritedRecordIds, [parent.id]);
  assert.equal(input.evidence.find(item => item.id === parent.id).text, parent.text);
  assert.deepEqual(input.evidence.find(item => item.id === target.id).claims[0].dependsOn, [1]);
  assert.equal(input.evidence.find(item => item.id === target.id).publicationDate, target.publicationDate);
  const legacy = store.save({ ...matter, evidenceIds: [target.id, cited.id], pinnedEvidence: matter.pinnedEvidence.filter(item => item.record.id !== parent.id) });
  assert.throws(() => buildPatentPrompt({ matter: legacy, targets: ['matrix'] }, { model: 'test-no-call' }), error => error.status === 422 && error.message.includes(parent.id));
  await assert.rejects(workflow.propose(legacy.id, { version: legacy.version, targets: ['matrix'] }, editor), { status: 422 });
  assert.throws(() => workflow.approve(legacy.id, { version: legacy.version, targets: ['matrix'] }, lawyer), { status: 422 });
  assert.equal(modelCalls, 0);
  matter = workflow.source(legacy.id, { version: legacy.version, evidenceIds: legacy.evidenceIds }, editor);
  assert.ok(matter.evidenceIds.includes(parent.id));
  matter = workflow.edit(matter.id, { version: matter.version, matrixRows: [{ ...row, claimQuote: parent.text.slice(0,120),
    d1RecordId: cited.id, d1Quote: cited.text.slice(0,80) }], response: { ...response, evidenceIds: ['case:notice'] } }, editor);
  assert.equal(matter.sections.matrix.rows[0].claimQuoteRecordId, parent.id);
  matter = workflow.approve(matter.id, { version: matter.version, targets: ['matrix', 'response'] }, lawyer);
  assert.match(documentXML(savedWord(store, workflow, matter.id, 1)).replaceAll('\u00a0', ' '), /Yêu cầu bảo hộ dẫn chiếu/);
});

 test('actual unresolved dependency anomaly needs context while manual input is explicitly unverified', async t => {
  const { store } = setup(t);
  const actual = loadDataset();
  const anomalous = actual.records.find(item => item.id === 'ep-ep2000000a1-claim-8');
  const cited = actual.records.find(item => item.id === 'us-patent-5783810-page-7-1');
  const workflow = createPatentWorkflow(store, actual);
  const matter = workflow.create({ ...body, reference: 'ANOMALY-DEPENDENCY', claimText: anomalous.text, claimRecordId: anomalous.id,
    claimVersion: anomalous.id, evidenceIds: [anomalous.id, cited.id], d1RecordIds: [cited.id] }, editor);
  assert.throws(() => buildPatentPrompt({ matter, targets: ['matrix'] }, { model: 'test-no-call' }), error => error.status === 422 && error.message.includes(anomalous.id));
  assert.throws(() => workflow.approve(matter.id, { version: matter.version, targets: ['matrix'] }, lawyer), { status: 422 });
  const manual = workflow.create({ ...body, reference: 'MANUAL-DEPENDENCY', claimText: 'Operator entered technical text.', claimRecordId: null,
    evidenceIds: [cited.id], d1RecordIds: [cited.id] }, editor);
  const input = JSON.parse(buildPatentPrompt({ matter: manual, targets: ['matrix'] }, { model: 'test-no-call' }).messages[1].content);
  assert.equal(input.claimContext.status, 'manual_input_unverified');
});

 test('model can select only pinned span IDs; rejected attempt receipt persists privately without a draft or replay', async t => {
  const { directory, store } = setup(t);
  const connection = { model: 'fixture-model', provider: 'fixture', endpoint: 'https://fixture.test/chat/completions', credential: async () => 'fake-key' };
  let calls = 0;
  const model = input => generatePatentProposal(input, { connection, fetcher: async (_, request) => {
    calls++; const options = JSON.parse(JSON.parse(request.body).messages[1].content).spanOptions;
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ matrix: { rows: [{
      feature: row.feature, claimSpanId: options.claim[0].id, d1SpanId: options.claim[0].id,
      assessment: 'uncertain', analysis: row.analysis, missing: row.missing }] } }) } }], usage: { prompt_tokens: 321, completion_tokens: 123 } });
  } });
  const workflow = createPatentWorkflow(store, dataset, model);
  const matter = workflow.create({ ...body, reference: 'SPAN-REJECTION' }, editor);
  await assert.rejects(() => workflow.propose(matter.id, { version: matter.version, targets: ['matrix'] }, editor),
    error => error.status === 422 && error.modelReceipt.promptTokens === 321 && error.modelReceipt.completionTokens === 123);
  assert.equal(calls, 1);
  const unchanged = workflow.read(matter.id, editor);
  assert.equal(unchanged.version, matter.version); assert.equal(unchanged.proposals.length, 0);
  assert.equal(Object.hasOwn(unchanged, 'modelReceipts'), false);
  const db = new DatabaseSync(resolve(directory, 'cases.sqlite'), { readOnly: true });
  const receipt = JSON.parse(db.prepare('SELECT content FROM patent_model_receipts WHERE case_id=?').get(matter.id).content); db.close();
  assert.equal(receipt.outcome, 'rejected'); assert.equal(receipt.error.kind, 'validation_rejected');
  assert.equal(receipt.model, connection.model); assert.equal(receipt.inputSha256.length, 64); assert.equal(receipt.outputSha256.length, 64);
  assert.equal(JSON.stringify(receipt).includes('fake-key'), false);
  assert.equal(JSON.stringify(receipt).includes(body.noticeText), false);
});
