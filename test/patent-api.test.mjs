import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { loadDataset } from '../patents/dataset.mjs';

const key = 'b'.repeat(64);
const account = { name: 'patent-reviewer', group: 'patent-test', role: 'reviewer', key };
const outside = { name: 'outside-reviewer', group: 'outside-team', role: 'reviewer', key: 'c'.repeat(64) };
const hash = value => createHash('sha256').update(value).digest('hex');
async function setup(t) {
  mkdirSync('work', { recursive: true });
  const directory = mkdtempSync(resolve('work/patent-api-'));
  const accounts = resolve(directory, 'accounts.json');
  writeFileSync(accounts, JSON.stringify([account, outside]), { mode: 0o600 });
  Object.assign(process.env, { VERCEL: '1', DAI_TIN_WEB: '1', DAI_TIN_M5: '1', DAI_TIN_M4: '1', DAI_TIN_M3: '1',
    DAI_TIN_PATENTS: '1', DAI_TIN_COPILOT: '1', DAI_TIN_PILOT: '1', DAI_TIN_CORPUS_MODE: 'preview', DAI_TIN_MODEL_MODE: 'disabled',
    DAI_TIN_PUBLIC_ORIGIN: 'https://patent-test.example', DAI_TIN_M3_STORE: resolve(directory, 'cases.sqlite'), DAI_TIN_M5_ACCOUNTS: accounts });
  const { createApp } = await import('../server.mjs');
  const app = createApp();
  t.after(() => { app.close(); rmSync(directory, { recursive: true, force: true }); });
  return async function call(path, { method = 'GET', body, signed = true, actor = account } = {}) {
    const result = { status: null, headers: {}, body: null,
      writeHead(status, headers) { this.status = status; this.headers = headers; },
      end(bytes) { this.body = Buffer.from(bytes ?? ''); }, json() { return JSON.parse(this.body); } };
    await app.handle({ url: path, method, body, headers: { host: 'patent-test.example', origin: 'https://patent-test.example',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(signed ? { authorization: 'Basic ' + Buffer.from(actor.name + ':' + actor.key).toString('base64') } : {}) },
      socket: { remoteAddress: '127.0.0.1' } }, result);
    return result;
  };
}

test('patent CEO entry authenticates HTML and APIs, preserves fixed return target and never makes active source HTML', async t => {
  const call = await setup(t);
  assert.equal((await call('/', { signed: false })).headers.Location, '/patents/');
  const login = await call('/patents/?case=11111111-1111-1111-1111-111111111111', { signed: false });
  assert.equal(login.status, 200);
  assert.match(login.body.toString(), /data-return-to="\/patents\/"/);
  assert.equal((await call('/api/patents/catalog', { signed: false })).status, 401);
  const catalogue = (await call('/api/patents/catalog')).json();
  assert.equal(catalogue.status, 'candidate');
  assert.ok(catalogue.records.length > 1000);
  assert.equal(Object.hasOwn(catalogue.records[0], 'text'), false);
  const data = loadDataset();
  const source = data.sources.find(item => item.snapshot.endsWith('.xml'));
  const path = '/api/patents/source/' + source.id + '/' + source.sha256;
  assert.equal((await call(path, { signed: false })).status, 401);
  assert.equal((await call('/api/patents/source/' + source.id + '/' + '0'.repeat(64))).status, 409);
  const captured = await call(path);
  assert.equal(captured.status, 200);
  assert.equal(captured.headers['Content-Type'], 'application/octet-stream');
  assert.match(captured.headers['Content-Disposition'], /^attachment/);
  assert.match(captured.headers['Content-Security-Policy'], /sandbox/);
  assert.equal(hash(captured.body), source.sha256);
  const largeLaw = data.sources.find(item => item.bytes > 5 * 1024 * 1024);
  const redirected = await call('/api/patents/source/' + largeLaw.id + '/' + largeLaw.sha256);
  assert.equal(redirected.status, 302);
  assert.equal(redirected.headers.Location, '/__sources/' + largeLaw.sha256 + '.pdf');
  const snippet = (await call('/api/patents/evidence/ep-ep1004359b1-claim-1')).json();
  assert.ok(snippet.openUrl.startsWith('/api/patents/source/'));
  assert.ok(snippet.originalUrl.startsWith('https://'));
});

test('patent API accepts bounded Vietnamese private inputs above16KiB and keeps them out of public retrieval', async t => {
  const call = await setup(t);
  const data = loadDataset();
  const evidenceId = 'ep-ep1004359b1-claim-1';
  const privateText = 'ả'.repeat(5500);
  const body = { synthetic: true, title: 'Hồ sơ mô phỏng riêng', reference: 'PAT-LARGE-VN', claimText: privateText,
    claimVersion: 'Người dùng nhập v1', claimRecordId: null, d1RecordIds: [], evidenceIds: [evidenceId],
    noticeText: privateText, instructionsText: privateText, jurisdiction: 'VN', asOf: data.builtAt.slice(0,10) };
  assert.ok(Buffer.byteLength(JSON.stringify(body)) > 16 * 1024);
  const created = await call('/api/patents/cases', { method: 'POST', body });
  assert.equal(created.status, 201);
  const matter = created.json();
  assert.equal(matter.noticeText, privateText);
  assert.equal((await call('/api/patents/cases/' + matter.id)).json().instructionsText, privateText);
  assert.equal((await call('/api/patents/catalog')).body.includes(Buffer.from(privateText)), false);
  assert.equal((await call('/api/patents/search', { method: 'POST', body: null })).status, 422);
  const example = await call('/api/patents/cases/example', { method: 'POST', body: { synthetic: true } });
  assert.equal(example.status, 201);
  assert.match(example.json().noticeText, /MÔ PHỎNG/);
  assert.ok(example.json().d1RecordIds.includes('us-patent-5783810-page-7-1'));
});

test('patent PDF intake preserves exact page provenance, blocks stale or tampered bindings and freezes the approved Word', async t => {
  const call = await setup(t);
  const post = (path, body, options) => call(path, { method: 'POST', body, ...options });
  const created = await post('/api/patents/cases', { synthetic: true, reference: 'PDF-INTAKE-TEST', title: 'Kiểm hồ sơ PDF mô phỏng',
    jurisdiction: 'VN', asOf: '2026-11-11', claimText: '', claimVersion: '', evidenceIds: [], d1RecordIds: [], claimRecordId: null });
  assert.equal(created.status, 201);
  let matter = created.json();
  const path = '/api/patents/cases/' + matter.id;
  const pdf = path + '/pdf/';
  const originals = ['DT-DEMO-02.pdf', 'DT-DEMO-03.pdf'].map(name => readFileSync(new URL('../distribution/demo/' + name, import.meta.url)));
  const inputs = originals.map(bytes => ({ version: matter.version, synthetic: true, content: bytes.toString('base64'), firstPage: 1, lastPage: 1 }));
  assert.equal((await post(pdf + 'inspect', inputs[0], { actor: outside })).status, 404);
  assert.equal((await post(pdf + 'inspect', { ...inputs[0], lastPage: 5 })).status, 422);
  const inspected = await post(pdf + 'inspect', inputs[0]);
  assert.equal(inspected.status, 200);
  const view = inspected.json();
  assert.equal(view.sha256, hash(originals[0]));
  assert.equal(view.pages.length, 1);
  assert.equal(view.pages[0].usable, true);
  assert.ok(view.pageCount > 1);
  const image = await post(pdf + 'preview', { ...inputs[0], sha256: view.sha256, page: 1 });
  assert.equal(image.headers['Content-Type'], 'image/png');
  assert.equal(image.headers['X-Source-SHA256'], view.sha256);
  assert.equal(image.body.subarray(1, 4).toString(), 'PNG');
  function selection(input, inspection, role, lineIndex = 0) {
    const { page, text } = inspection.pages[0];
    const selected = text.split('\n').filter(line => line.trim().length >= 10)[lineIndex].trim();
    const start = text.indexOf(selected);
    return { ...input, version: matter.version, sha256: inspection.sha256, role, label: 'Fixture PDF ' + role,
      page, start, end: start + selected.length, text: selected, confirmed: true };
  }
  const claim = selection(inputs[0], view, 'claim');
  assert.equal((await post(pdf + 'bind', { ...claim, sha256: '0'.repeat(64) })).status, 409);
  assert.equal((await post(pdf + 'bind', { ...claim, text: claim.text + 'x' })).status, 422);
  assert.equal((await post(pdf + 'bind', { ...claim, page: 2 })).status, 422);
  const bound = await post(pdf + 'bind', claim);
  assert.equal(bound.status, 200);
  matter = bound.json();
  assert.equal(matter.claimText, claim.text);
  assert.equal(matter.documents[0].textSha256, hash(claim.text));
  assert.equal(matter.pinnedEvidence[0].record.id, matter.claimRecordId);
  assert.equal((await post(pdf + 'bind', claim)).status, 409);
  assert.equal((await post(pdf + 'bind', selection(inputs[0], view, 'd1', 1))).status, 422);
  const notice = await post(pdf + 'bind', selection(inputs[0], view, 'notice', 1));
  assert.equal(notice.status, 200);
  matter = notice.json();
  assert.equal(matter.documents[1].attachmentId, matter.documents[0].attachmentId);
  const d1Inspected = (await post(pdf + 'inspect', { ...inputs[1], version: matter.version })).json();
  const d1Binding = selection(inputs[1], d1Inspected, 'd1');
  assert.equal(d1Binding.text, claim.text);
  assert.notEqual(d1Binding.sha256, claim.sha256);
  const d1 = await post(pdf + 'bind', d1Binding);
  assert.equal(d1.status, 200);
  matter = d1.json();
  const document = matter.documents.find(item => item.role === 'd1');
  assert.equal(document.recordId, matter.d1RecordIds[0]);
  assert.equal((await call('/api/patents/evidence/' + document.recordId)).status, 404);
  assert.equal((await call(document.openUrl, { signed: false })).status, 401);
  assert.equal((await call(document.pageUrl, { actor: outside })).status, 404);
  const original = await call(document.openUrl);
  assert.match(original.headers['Content-Disposition'], /^attachment/);
  assert.equal(original.headers['X-Source-SHA256'], document.sha256);
  assert.deepEqual(original.body, originals[1]);

  matter = (await post(path + '/source', { version: matter.version, evidenceIds: matter.evidenceIds,
    instructionsText: 'Đối chiếu lớp chữ và giữ nguyên mức độ chắc chắn.' })).json();
  matter = (await post(path + '/edit', { version: matter.version,
    matrixRows: [{ feature: 'Dấu hiệu mô phỏng', claimQuote: claim.text, d1RecordId: document.recordId,
      d1Quote: d1Binding.text, assessment: 'uncertain', analysis: 'So sánh thử dữ kiện lớp chữ.', missing: 'Rà soát phạm vi mô phỏng.' }],
    response: { text: 'Bản nháp mô phỏng cần đối chiếu trang nguồn.', evidenceIds: [document.recordId, 'case:notice'] } })).json();
  assert.equal(matter.sections.matrix.reviewRequired, true);
  assert.equal((await post(path + '/approve', { version: matter.version, targets: ['matrix'] })).status, 422);
  matter = (await post(path + '/approve', { version: matter.version, targets: ['matrix'], reviewed: true })).json();
  assert.equal((await call(path + '/word/1')).status, 404);
  matter = (await post(path + '/approve', { version: matter.version, targets: ['response'], reviewed: true })).json();
  const word = await call(path + '/word/1');
  assert.equal(word.status, 200);
  assert.equal(matter.releases[0].artifact.sha256, hash(word.body));
  assert.equal(matter.releases[0].documents[2].sha256, document.sha256);
  const detached = await post(path + '/source', { version: matter.version,
    evidenceIds: matter.evidenceIds.filter(id => id !== document.recordId), d1RecordIds: [] });
  assert.equal(detached.status, 200);
  assert.equal(detached.json().sections.matrix.approval, null);
  assert.equal(detached.json().sections.response.approval, null);
  assert.deepEqual((await call(document.openUrl)).body, originals[1]);
  assert.deepEqual((await call(path + '/word/1')).body, word.body);
});
