import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { webSettings, allowedRequest, windowLimit } from '../web/security.mjs';
import { modelConnection } from '../copilot/model-connection.mjs';
import { pilotAccess } from '../copilot/m5/access.mjs';
import { createDraftModel } from '../copilot/m3/workflow.mjs';

const env = { DAI_TIN_WEB: '1', DAI_TIN_PUBLIC_ORIGIN: 'https://pilot.example.com', DAI_TIN_M5: '1',
  DAI_TIN_M3: '1', DAI_TIN_COPILOT: '1', DAI_TIN_PILOT: '1' };
test('web validates HTTPS and mandatory auth, and ignores spoofed proxy headers', () => {
  assert.equal(webSettings({}), null);
  const config = webSettings(env);
  assert.equal(config.secure, true);
  for (const origin of ['http://public.example.com', 'https://pilot.example.com/path', 'https://key@pilot.example.com',
    'https://pilot.example.com?x=1']) assert.throws(() => webSettings({ ...env, DAI_TIN_PUBLIC_ORIGIN: origin }));
  assert.throws(() => webSettings({ ...env, DAI_TIN_M5: '0' }));
  assert.throws(() => webSettings({ ...env, DAI_TIN_PUBLIC_ORIGIN: 'http://127.0.0.1:4328' }));
  assert.equal(webSettings({ ...env, DAI_TIN_PUBLIC_ORIGIN: 'http://127.0.0.1:4328', DAI_TIN_WEB_TEST_HTTP: '1' }).secure, false);
  const req = headers => ({ method: 'POST', headers, socket: { localPort: 4320 } });
  assert.equal(allowedRequest(req({ host: config.host, origin: config.origin }), config), true);
  assert.equal(allowedRequest(req({ host: 'evil.example', 'x-forwarded-host': config.host }), config), false);
  assert.equal(allowedRequest(req({ host: config.host, origin: 'https://evil.example' }), config), false);
  assert.equal(allowedRequest(req({ host: config.host, 'sec-fetch-site': 'cross-site' }), config), false);
  assert.equal(allowedRequest({ ...req({ host: config.host, 'sec-fetch-site': 'cross-site' }), method: 'GET' }, config), true);
});

test('web rate limits expire without accepting an unbounded number of keys', () => {
  const limited = windowLimit(2, 1000, 2);
  assert.equal(limited('a', 0), true);
  assert.equal(limited('a', 1), true);
  assert.equal(limited('a', 2), false);
  assert.equal(limited('b', 3), true);
  assert.equal(limited('c', 4), false);
  assert.equal(limited('a', 1001), true);
});

test('server model endpoint requires HTTPS, private key file and explicit configuration', t => {
  const dir = mkdtempSync(resolve('work/model-connection-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const keyFile = resolve(dir, 'model.key');
  writeFileSync(keyFile, 'example-provider-key-for-unit-check', { mode: 0o600 });
  const options = { model: 'organization/model', endpoint: 'https://model.example.com/v1/chat/completions', keyFile };
  const connection = modelConnection(options);
  assert.equal(connection.provider, 'model.example.com');
  assert.equal(modelConnection({ mode: 'disabled' }), null);
  for (const endpoint of ['http://model.example.com/v1/chat/completions',
    'https://key@model.example.com/v1/chat/completions', 'https://model.example.com/v1/chat/completions?key=x',
    'https://model.example.com/v1/chat/completions#x']) assert.throws(() => modelConnection({ ...options, endpoint }));
  assert.throws(() => modelConnection({ ...options, mode: 'typo' }));
  const loginFile = resolve(dir, 'accounts.json');
  writeFileSync(loginFile, JSON.stringify([{ name: 'lawyer', group: 'trademark', role: 'reviewer', key: 'a'.repeat(64) }]), { mode: 0o600 });
  const access = pilotAccess(loginFile, { secure: true });
  const cookie = access.login('lawyer', 'a'.repeat(64));
  assert.match(cookie, /; Secure$/);
  assert.match(access.logout({ headers: { cookie: cookie.split(';')[0] } }), /Max-Age=0; Secure$/);
});

test('HTTPS model adapter uses server-held key, named schema and no redirect or retry', async t => {
  const dir = mkdtempSync(resolve('work/model-adapter-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const keyFile = resolve(dir, 'model.key');
  writeFileSync(keyFile, 'example-key-for-protocol-check', { mode: 0o600 });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url, request) => {
    calls++;
    assert.equal(url, 'https://model.example.com/v1/chat/completions');
    assert.equal(request.redirect, 'error');
    assert.equal(request.headers.Authorization, 'Bearer example-key-for-protocol-check');
    const payload = JSON.parse(request.body);
    assert.equal(payload.response_format.json_schema.name, 'daitin_draft');
    assert.equal(payload.response_format.json_schema.strict, true);
    assert.deepEqual(payload.response_format.json_schema.schema.required, ['response']);
    assert.equal(payload.messages.some(item => item.content.includes('example-key-for-protocol-check')), false);
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
      response: { text: 'Đề nghị làm rõ tên hàng hóa.', sources: ['instructions'] }
    }) } }] });
  });
  const model = createDraftModel({ mode: 'enabled', endpoint: 'https://model.example.com/v1/chat/completions',
    keyFile, model: 'example-model' });
  const result = await model({ facts: {}, sources: [{ id: 'instructions', label: 'Chỉ dẫn', text: 'Làm rõ tên hàng hóa.' }],
    basis: { citations: [] }, targets: ['response'], instruction: 'Làm rõ.' });
  assert.equal(calls, 1);
  assert.equal(result.run.provider, 'model.example.com');
});

test('web server guards all APIs, retains approved releases, stale writes and group isolation', async t => {
  const dir = mkdtempSync(resolve('work/web-http-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  Object.assign(process.env, env, { DAI_TIN_CORPUS_MODE: 'preview', DAI_TIN_M4: '1', DAI_TIN_MODEL_MODE: 'disabled',
    DAI_TIN_M3_STORE: resolve(dir, 'cases.sqlite'), DAI_TIN_M5_ACCOUNTS: resolve(dir, 'accounts.json') });
  const users = [
    { name: 'lawyer', group: 'nhan-hieu', role: 'reviewer', key: 'a'.repeat(64) },
    { name: 'editor', group: 'nhan-hieu', role: 'editor', key: 'b'.repeat(64) },
    { name: 'other', group: 'other', role: 'reviewer', key: 'c'.repeat(64) }
  ];
  writeFileSync(process.env.DAI_TIN_M5_ACCOUNTS, JSON.stringify(users), { mode: 0o600 });
  const { openCaseStore } = await import('../copilot/m3/store.mjs');
  const store = openCaseStore(process.env.DAI_TIN_M3_STORE, true);
  const seed = JSON.parse(readFileSync(new URL('../distribution/demo/seed.json', import.meta.url))).cases[0];
  store.create(seed.matter, readFileSync(new URL('../distribution/demo/' + seed.pdf, import.meta.url)));
  store.close();
  const { createServer } = await import('../server.mjs');
  const server = createServer();
  await new Promise((ok, fail) => server.listen(0, '127.0.0.1', ok).once('error', fail));
  t.after(() => new Promise(ok => server.close(ok)));
  const call = (path, body, cookie, extra = {}) => new Promise((ok, fail) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path,
      method: body === undefined ? 'GET' : 'POST', headers: { Host: 'pilot.example.com',
        ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...extra } }, res => {
      const parts = [];
      res.on('data', data => parts.push(data));
      res.on('end', () => { const bytes = Buffer.concat(parts); ok({ status: res.statusCode, headers: res.headers,
        bytes, json: () => JSON.parse(bytes) }); });
    });
    req.on('error', fail);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
  assert.equal((await call('/')).headers.location, '/copilot/m3/workspace/');
  assert.match((await call('/copilot/m3/workspace/')).bytes.toString(), /Tiếp tục công việc/);
  for (const path of ['/api/catalog', '/api/copilot/catalog', '/api/m3/cases', '/copilot/']) assert.equal((await call(path)).status, 401, path);
  assert.equal((await call('/healthz', undefined, undefined, { Host: 'evil.example' })).status, 403);
  assert.equal((await call('/api/m5/session', {}, undefined, { Origin: 'https://evil.example' })).status, 403);
  const login = async user => {
    const response = await call('/api/m5/session', { username: user.name, key: user.key });
    assert.equal(response.status, 200);
    assert.match(response.headers['set-cookie'][0], /; Secure$/);
    return response.headers['set-cookie'][0].split(';')[0];
  };
  const cookie = await login(users[0]);
  const editor = await login(users[1]);
  const other = await login(users[2]);
  const path = '/api/m3/cases/' + seed.matter.id;
  const word = number => '/api/m4/cases/' + seed.matter.id + '/word/' + number + '/daitin-v2';
  assert.equal((await call(path, undefined, other)).status, 404);
  assert.deepEqual((await call('/api/m3/cases', undefined, other)).json(), []);
  assert.equal((await call(path + '/edit', { version: seed.matter.version, edits: { response: 'Khác nhóm' } }, other)).status, 404);
  assert.equal((await call('/api/m5/status', undefined, cookie)).json().model, null);
  const original = await call(word(1), undefined, cookie);
  let matter = (await call(path, undefined, cookie)).json();
  const unchangedVersion = matter.version;
  const disabled = await call(path + '/propose', { version: matter.version, sources: ['notice', 'instructions'],
    targets: ['response'], instruction: 'Cập nhật phản hồi.' }, cookie);
  assert.equal(disabled.status, 503);
  assert.equal((await call(path, undefined, cookie)).json().version, unchangedVersion);
  matter = (await call(path + '/edit', { version: matter.version, edits: { response: '[Luật sư xác nhận]' } }, cookie)).json();
  assert.equal((await call(path + '/approve', { version: matter.version, targets: ['response'] }, cookie)).status, 422);
  assert.equal((await call(word(2), undefined, cookie)).status, 404);
  const oldVersion = matter.version;
  matter = (await call(path + '/source', { version: matter.version, label: 'Chỉ dẫn mới', text: 'Khách hàng xác nhận nhiệt kế hồng ngoại.' }, cookie)).json();
  assert.equal((await call(path + '/edit', { version: matter.version, edits: { response: 'Tên mới' }, sources: { response: ['not-a-source'] } }, cookie)).status, 400);
  matter = (await call(path + '/edit', { version: matter.version, edits: { response: 'Đề nghị làm rõ thành nhiệt kế hồng ngoại.' },
    sources: { response: ['instructions', 'update-1'] } }, cookie)).json();
  assert.equal((await call(path + '/edit', { version: oldVersion, edits: { response: 'Ghi đè từ tab cũ' } }, cookie)).status, 409);
  assert.equal((await call(path + '/approve', { version: matter.version, targets: ['response'] }, editor)).status, 403);
  matter = (await call(path + '/approve', { version: matter.version, targets: ['response'] }, cookie)).json();
  assert.equal(matter.releases.length, 2);
  assert.equal(matter.releases[1].approvedBy.name, users[0].name);
  assert.ok(matter.releases[1].sources.some(item => item.id === 'update-1'));
  assert.deepEqual(matter.releases[1].sections.findings, matter.releases[0].sections.findings);
  assert.deepEqual((await call(word(1), undefined, cookie)).bytes, original.bytes);
  assert.equal((await call(word(2), undefined, cookie)).status, 200);
  await call('/api/m5/session/logout', {}, cookie);
  assert.equal((await call(path, undefined, cookie)).status, 401);
  const next = await login(users[0]);
  assert.equal((await call(path, undefined, next)).json().releases.length, 2);
});
