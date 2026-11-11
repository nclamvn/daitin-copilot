import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { loadDataset } from '../patents/dataset.mjs';

const key = 'b'.repeat(64);
const account = { name: 'patent-reviewer', group: 'patent-test', role: 'reviewer', key };
const hash = value => createHash('sha256').update(value).digest('hex');
async function setup(t) {
  mkdirSync('work', { recursive: true });
  const directory = mkdtempSync(resolve('work/patent-api-'));
  const accounts = resolve(directory, 'accounts.json');
  writeFileSync(accounts, JSON.stringify([account]), { mode: 0o600 });
  Object.assign(process.env, { VERCEL: '1', DAI_TIN_WEB: '1', DAI_TIN_M5: '1', DAI_TIN_M4: '1', DAI_TIN_M3: '1',
    DAI_TIN_PATENTS: '1', DAI_TIN_COPILOT: '1', DAI_TIN_PILOT: '1', DAI_TIN_CORPUS_MODE: 'preview', DAI_TIN_MODEL_MODE: 'disabled',
    DAI_TIN_PUBLIC_ORIGIN: 'https://patent-test.example', DAI_TIN_M3_STORE: resolve(directory, 'cases.sqlite'), DAI_TIN_M5_ACCOUNTS: accounts });
  const { createApp } = await import('../server.mjs');
  const app = createApp();
  t.after(() => { app.close(); rmSync(directory, { recursive: true, force: true }); });
  return async function call(path, { method = 'GET', body, signed = true } = {}) {
    const result = { status: null, headers: {}, body: null,
      writeHead(status, headers) { this.status = status; this.headers = headers; },
      end(bytes) { this.body = Buffer.from(bytes ?? ''); }, json() { return JSON.parse(this.body); } };
    await app.handle({ url: path, method, body, headers: { host: 'patent-test.example', origin: 'https://patent-test.example',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(signed ? { authorization: 'Basic ' + Buffer.from(account.name + ':' + key).toString('base64') } : {}) },
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
