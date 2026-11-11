import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createSnapshotRuntime, makeSnapshot, inspectSnapshot } from '../web/snapshot-runtime.mjs';
import { pilotAccess } from '../copilot/m5/access.mjs';
import { modelConnection } from '../copilot/model-connection.mjs';

const database = () => Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.from('fixture')]);
const account = { name: 'lawyer', group: 'nhan-hieu', role: 'reviewer', key: 'a'.repeat(64) };
function memoryStore(initial = makeSnapshot(database(), { accounts: [account] })) {
  let state = structuredClone(initial);
  let revision = 1;
  let writes = 0;
  return {
    failWrite: null,
    read: async () => ({ state: structuredClone(state), etag: String(revision) }),
    async write(next, etag) {
      writes++;
      if (this.failWrite === writes) throw new Error('Injected storage outage');
      if (etag !== String(revision)) throw Object.assign(new Error('Conflict'), { conflict: true });
      state = structuredClone(next); revision++;
      return { etag: String(revision) };
    },
    isConflict: error => error.conflict === true,
    state: () => structuredClone(state),
    writes: () => writes
  };
}
function setup(t) {
  mkdirSync(resolve('work'), { recursive: true });
  const directory = mkdtempSync(resolve('work/runtime-check-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function request(url = '/', method = 'GET', headers = {}) {
  return { method, url, headers, socket: { remoteAddress: '127.0.0.1', localPort: 4320 } };
}
function response() {
  return { status: null, headers: {}, body: null,
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body) { this.body = Buffer.from(body ?? ''); } };
}
const reply = (res, status = 200, fields = {}) => { res.writeHead(status, { 'Content-Type': 'application/json', ...fields }); res.end('{}'); };
const keepAuth = state => ({ sessions: state.sessions, modelLimits: state.modelLimits, loginLimits: state.loginLimits });

test('Gateway OIDC configuration is evaluated after endpoint validation and needs no stored API key', t => {
  const previous = process.env.VERCEL;
  process.env.VERCEL = '1';
  t.after(() => { if (previous === undefined) delete process.env.VERCEL; else process.env.VERCEL = previous; });
  const connection = modelConnection({ mode: 'enabled', endpoint: 'https://ai-gateway.vercel.sh/v1/chat/completions',
    model: 'google/gemini-2.5-flash-lite', keyFile: null });
  assert.equal(connection.provider, 'ai-gateway.vercel.sh');
  assert.equal(connection.key, null);
  assert.equal(typeof connection.credential, 'function');
  assert.throws(() => modelConnection({ mode: 'enabled', endpoint: 'https://unapproved.example/v1/chat/completions',
    model: 'example', keyFile: null }));
});

test('runtime rejects invalid origin before touching private storage', async () => {
  let reads = 0;
  const runtime = createSnapshotRuntime({ preflight: () => false, store: { read: () => { reads++; } }, accounts: () => [account],
    run: () => { throw new Error('Must not execute'); } });
  const result = response(); await runtime(request('/save', 'POST'), result);
  assert.equal(result.status, 403); assert.equal(reads, 0);
});

test('runtime serializes cross-isolate writes by Blob lease and never runs a losing mutation', async t => {
  const directory = setup(t);
  const store = memoryStore();
  let started;
  const entered = new Promise(ok => { started = ok; });
  let finish;
  const wait = new Promise(ok => { finish = ok; });
  const a = createSnapshotRuntime({ store, accounts: () => [account], temporaryRoot: directory,
    async run({ res, state, databasePath }) { started(); await wait; writeFileSync(databasePath, Buffer.concat([database(), Buffer.from('new')])); reply(res); return keepAuth(state); } });
  let loserCalls = 0;
  const b = createSnapshotRuntime({ store, accounts: () => [account], temporaryRoot: directory,
    async run() { loserCalls++; } });
  const accepted = response();
  const pending = a(request('/edit', 'POST'), accepted);
  await entered;
  const rejected = response();
  await b(request('/edit', 'POST'), rejected);
  assert.equal(rejected.status, 409);
  assert.equal(loserCalls, 0);
  finish(); await pending;
  assert.equal(accepted.status, 200);
  assert.equal(store.state().lease, null);
  assert.ok(Buffer.from(store.state().database, 'base64').toString().endsWith('new'));
  assert.deepEqual(readdirSync(directory), []);
});

test('runtime cold session restore and logout use hashes and central account revocation', async t => {
  const directory = setup(t);
  const accountFile = resolve(directory, 'accounts.json');
  writeFileSync(accountFile, JSON.stringify([account]), { mode: 0o600 });
  const initial = pilotAccess(accountFile, { secure: true });
  const cookie = initial.login(account.name, account.key).split(';')[0];
  const sessions = initial.snapshot();
  assert.notEqual(sessions[0][0], cookie.split('=')[1]);
  const store = memoryStore(makeSnapshot(database(), { accounts: [account], sessions }));
  const make = () => createSnapshotRuntime({ store, accounts: () => { throw new Error('Must prefer central accounts'); }, temporaryRoot: directory,
    async run({ req, res, accountsPath, state }) {
      const access = pilotAccess(accountsPath, { secure: true, savedSessions: state.sessions });
      const actor = access(req);
      if (req.url === '/logout') access.logout(req);
      reply(res, actor ? 200 : 401);
      return { ...keepAuth(state), sessions: access.snapshot() };
    } });
  const first = response(); await make()(request('/', 'GET', { cookie }), first); assert.equal(first.status, 200);
  const loggedOut = response(); await make()(request('/logout', 'POST', { cookie }), loggedOut); assert.equal(loggedOut.status, 200);
  const cold = response(); await make()(request('/', 'GET', { cookie }), cold); assert.equal(cold.status, 401);
  rmSync(accountFile);
  assert.deepEqual(readdirSync(directory), []);
});

test('runtime does not acknowledge a cookie or DB write when durable commit fails', async t => {
  const directory = setup(t);
  const store = memoryStore(); store.failWrite = 2;
  const before = store.state().databaseSHA256;
  let calls = 0;
  const runtime = createSnapshotRuntime({ store, accounts: () => [account], temporaryRoot: directory,
    async run({ res, databasePath, state }) {
      calls++; writeFileSync(databasePath, Buffer.concat([database(), Buffer.from('uncommitted')]));
      reply(res, 201, { 'Set-Cookie': 'must-not-be-sent' }); return keepAuth(state);
    } });
  const result = response(); await runtime(request('/save', 'POST'), result);
  assert.equal(calls, 1);
  assert.equal(result.status, 503);
  assert.equal(result.headers['Set-Cookie'], undefined);
  assert.equal(store.state().databaseSHA256, before);
  assert.equal(store.state().lease, null);
  assert.deepEqual(readdirSync(directory), []);
});

for (const domain of ['m3', 'patents']) test('runtime consumes a ' + domain + ' model reservation before dispatch and keeps it after an exception', async t => {
  const directory = setup(t);
  const store = memoryStore();
  const headers = { authorization: 'Basic ' + Buffer.from(account.name + ':' + account.key).toString('base64') };
  let modelCalls = 0;
  const runtime = createSnapshotRuntime({ store, accounts: () => [account], temporaryRoot: directory,
    async run({ modelReserved }) {
      assert.equal(modelReserved, true);
      assert.equal(store.state().modelLimits[0][1].count, 1);
      modelCalls++;
      throw new Error('Model request interrupted');
    } });
  const result = response(); await runtime(request('/api/' + domain + '/cases/' + 'a'.repeat(8) + '-aaaa-aaaa-aaaa-' + 'a'.repeat(12) + '/propose', 'POST', headers), result);
  assert.equal(result.status, 503);
  assert.equal(modelCalls, 1);
  assert.equal(store.state().modelLimits[0][1].count, 1);
  assert.equal(store.state().lease, null);
  assert.deepEqual(readdirSync(directory), []);
});

test('runtime discards GET-only Word cache and rejects corrupt snapshots before application code', async t => {
  const directory = setup(t);
  const store = memoryStore();
  const runtime = createSnapshotRuntime({ store, accounts: () => [account], temporaryRoot: directory,
    async run({ res, state, databasePath }) { writeFileSync(databasePath, Buffer.concat([database(), Buffer.from('cache')])); reply(res); return keepAuth(state); } });
  const result = response(); await runtime(request('/word/1'), result);
  assert.equal(result.status, 200); assert.equal(store.writes(), 0);
  assert.equal(Buffer.from(store.state().database, 'base64').toString(), database().toString());
  assert.throws(() => inspectSnapshot({ ...store.state(), databaseSHA256: '0'.repeat(64) }));
  assert.deepEqual(readdirSync(directory), []);
});

test('patent search and PDF previews authenticate against committed state without taking a write lease', async t => {
  const directory = setup(t);
  const initial = makeSnapshot(database(), { accounts: [account] });
  initial.lease = { id: 'other-isolate', until: Date.now() + 30000 };
  const store = memoryStore(initial);
  const headers = { authorization: 'Basic ' + Buffer.from(account.name + ':' + account.key).toString('base64') };
  const casePath = '/api/patents/cases/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  let calls = 0;
  const runtime = createSnapshotRuntime({ store, accounts: () => [account], temporaryRoot: directory,
    async run({ req, res, state, databasePath, accountsPath, modelReserved }) {
      calls++;
      assert.equal(modelReserved, false);
      assert.deepEqual(readFileSync(databasePath), database());
      const actor = pilotAccess(accountsPath, { secure: true, savedSessions: state.sessions })(req);
      reply(res, actor ? 200 : 401);
      return keepAuth(state);
    } });
  for (const path of ['/api/patents/search', casePath + '/pdf/inspect', casePath + '/pdf/preview?selection=1',
    '/api/patents/pdf-pack/inspect', '/api/patents/pdf-pack/preview']) {
    const result = response();
    await runtime(request(path, 'POST', headers), result);
    assert.equal(result.status, 200, path);
  }
  const anonymous = response();
  await runtime(request(casePath + '/pdf/inspect', 'POST'), anonymous);
  assert.equal(anonymous.status, 401);
  for (const path of ['/api/m4/pdf/preview', casePath + '/pdf/bind', '/proxy' + casePath + '/pdf/inspect',
    '/api/patents/cases/pdf-pack', '/proxy/api/patents/pdf-pack/inspect']) {
    const result = response();
    await runtime(request(path, 'POST', headers), result);
    assert.equal(result.status, 409, path);
  }
  assert.equal(calls, 6);
  assert.equal(store.writes(), 0);
  assert.deepEqual(store.state(), initial);
  assert.deepEqual(readdirSync(directory), []);
});

test('approval refuses a manually completed model placeholder with no selected source', async t => {
  const directory = setup(t);
  process.env.DAI_TIN_CORPUS_MODE = 'preview';
  const [{ openCaseStore, createCaseWorkflow }, { getCatalog, resolveProcedure }, { createCopilot }] = await Promise.all([
    import('../copilot/m3/store.mjs'), import('../research.mjs'), import('../copilot/service.mjs')
  ]);
  const source = JSON.parse(readFileSync(new URL('../distribution/demo/seed.json', import.meta.url))).cases[0].matter;
  const matter = structuredClone(source);
  matter.drafts.at(-1).sections.response = { text: '[Luật sư xác nhận]', sources: [] };
  const cases = openCaseStore(resolve(directory, 'cases.sqlite'), true);
  const copilot = createCopilot(getCatalog(), resolveProcedure);
  t.after(() => { cases.close(); copilot.close(); });
  cases.create(matter);
  const workflow = createCaseWorkflow(cases, copilot.review, async () => { throw new Error('No model expected'); });
  let edited = workflow.edit(matter.id, { version: matter.version, edits: { response: 'Nội dung đã sửa bằng tay.' } });
  assert.throws(() => workflow.approve(matter.id, { version: edited.version, targets: ['response'] }, account), { status: 422 });
  edited = workflow.edit(matter.id, { version: edited.version, edits: { response: 'Nội dung đã sửa bằng tay.' }, sources: { response: ['instructions'] } });
  const approved = workflow.approve(matter.id, { version: edited.version, targets: ['response'] }, account);
  assert.equal(approved.releases.length, 2);
  assert.deepEqual(approved.releases[1].sections.response.sources, ['instructions']);
});
