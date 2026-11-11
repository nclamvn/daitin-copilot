import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { sourceManifest, verifiedSources, stageSources, sourceRedirect, frontendAssets } from '../web/static-sources.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture(t) {
  mkdirSync(resolve('work'), { recursive: true });
  const root = mkdtempSync(resolve('work/static-sources-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(resolve(root, 'corpus/snapshots'), { recursive: true });
  const bytes = Buffer.from('%PDF-1.4\nPublic fixture, no matter content.');
  const entry = { id: 'fixture', type: 'pdf', storage: 'mvp', file: 'fixture.pdf',
    url: 'https://datafiles.chinhphu.vn/fixture.pdf', sha256: hash(bytes) };
  writeFileSync(resolve(root, 'corpus/snapshots/fixture.pdf'), bytes);
  return { root, bytes, entry };
}

test('static staging emits only hash-named verified PDF files, never a root index or uploaded material', t => {
  const { root, bytes, entry } = fixture(t);
  const result = stageSources({ appRoot: root, entries: [entry, entry], includeFrontendAssets: false });
  assert.deepEqual(result, { files: 1, bytes: bytes.length, assets: 0 });
  assert.deepEqual(readdirSync(resolve(root, 'dist')), ['__sources']);
  assert.deepEqual(readdirSync(resolve(root, 'dist/__sources')), [entry.sha256 + '.pdf']);
  assert.deepEqual(readFileSync(resolve(root, 'dist/__sources', entry.sha256 + '.pdf')), bytes);
});

test('static staging rejects nonofficial, traversal and changed source bytes before deleting prior output', t => {
  const { root, bytes, entry } = fixture(t);
  for (const bad of [{ ...entry, url: 'https://evil.example/fixture.pdf' }, { ...entry, storage: 'work' },
    { ...entry, file: '../client.pdf' }, { ...entry, type: 'xlsx' }]) {
    assert.throws(() => verifiedSources([bad], root));
  }
  stageSources({ appRoot: root, entries: [entry], includeFrontendAssets: false });
  writeFileSync(resolve(root, 'corpus/snapshots/fixture.pdf'), Buffer.from('%PDF-1.4\nChanged source.'));
  assert.throws(() => stageSources({ appRoot: root, entries: [entry], includeFrontendAssets: false }));
  assert.deepEqual(readFileSync(resolve(root, 'dist/__sources', entry.sha256 + '.pdf')), bytes);
});

test('frontend CDN staging uses exact safe allowlist and preserves bytes without exposing HTML, server modules or case data', t => {
  const { root, entry } = fixture(t);
  const expectedPaths = ['fonts.css', 'public/fonts.css', 'brand.css', 'public/brand.css', 'brand/daitin.png',
    'public/brand/daitin.png', 'copilot/m3/login.css', 'copilot/m3/login.js', 'copilot/m3/workspace/app.css',
    'copilot/m3/workspace/app.mjs', 'copilot/m3/workspace/entry.js', 'copilot/m3/workspace/pdf.mjs',
    'copilot/m3/workspace/research.mjs'];
  assert.deepEqual(frontendAssets.map(item => item.pathname), expectedPaths);
  for (const item of frontendAssets) {
    assert.doesNotMatch(item.source, /(?:\.html$|server\.mjs|seed|accounts|word-brand|m4\/brand|work\/|snapshot)/);
    const path = resolve(root, item.source);
    mkdirSync(resolve(path, '..'), { recursive: true });
    writeFileSync(path, readFileSync(new URL('../' + item.source, import.meta.url)));
  }
  const result = stageSources({ appRoot: root, entries: [entry] });
  assert.equal(result.assets, expectedPaths.length);
  for (const item of frontendAssets) {
    assert.deepEqual(readFileSync(resolve(root, 'dist', item.pathname)), readFileSync(resolve(root, item.source)));
  }
  const output = readdirSync(resolve(root, 'dist'), { recursive: true }).filter(path => !path.endsWith('/'));
  assert.ok(!output.some(path => /(?:\.html$|accounts|seed|word-brand|server\.mjs|\.sqlite|\.key)/.test(path)));
});

test('real official manifests include large PDFs and hash-pin redirects reject mismatches', () => {
  const entries = sourceManifest();
  assert.ok(entries.some(item => item.id === 'law131'));
  const copilot = JSON.parse(readFileSync(new URL('../copilot/sources.json', import.meta.url)));
  const registry = JSON.parse(readFileSync(new URL('../sot/candidate.json', import.meta.url))).payload.registry;
  const catalog = { documents: Object.entries(registry.documents).map(([id, item]) => ({ ...item, id })) };
  const large = verifiedSources(entries).filter(item => item.bytes.length > 4.5 * 1024 * 1024);
  assert.ok(large.length >= 5);
  const known = catalog.documents.find(item => item.id === 'vbhn06');
  assert.deepEqual(sourceRedirect('/sources/vbhn06/' + known.sha256 + '.pdf', catalog, copilot),
    { status: 302, location: '/__sources/' + known.sha256 + '.pdf' });
  assert.equal(sourceRedirect('/sources/vbhn06/' + '0'.repeat(64) + '.pdf', catalog, copilot).status, 409);
  assert.equal(sourceRedirect('/sources/not-found.pdf', catalog, copilot).status, 404);
  assert.equal(sourceRedirect('/copilot/source/tm-events.pdf', catalog, copilot).status, 404);
  assert.equal(sourceRedirect('/copilot/source/law131.pdf', catalog, copilot).location, '/__sources/' + copilot.law131.sha256 + '.pdf');
});

test('Vercel source route authenticates before redirect and never streams oversized PDF through Function', async t => {
  const { root } = fixture(t);
  const accounts = resolve(root, 'accounts.json');
  writeFileSync(accounts, JSON.stringify([{ name: 'lawyer', group: 'nhan-hieu', role: 'reviewer', key: 'a'.repeat(64) }]), { mode: 0o600 });
  Object.assign(process.env, { VERCEL: '1', DAI_TIN_WEB: '1', DAI_TIN_M5: '1', DAI_TIN_M4: '1', DAI_TIN_M3: '1',
    DAI_TIN_COPILOT: '1', DAI_TIN_PILOT: '1', DAI_TIN_CORPUS_MODE: 'preview', DAI_TIN_MODEL_MODE: 'disabled',
    DAI_TIN_PUBLIC_ORIGIN: 'https://pilot.example.com', DAI_TIN_M3_STORE: resolve(root, 'cases.sqlite'), DAI_TIN_M5_ACCOUNTS: accounts });
  const { createApp } = await import('../server.mjs');
  const app = createApp();
  t.after(app.close);
  async function call(path, signed = true) {
    const result = { status: null, headers: {}, body: null, writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { this.body = Buffer.from(body ?? ''); } };
    const req = { url: path, method: 'GET', headers: { host: 'pilot.example.com', ...(signed ? {
      authorization: 'Basic ' + Buffer.from('lawyer:' + 'a'.repeat(64)).toString('base64') } : {}) }, socket: { remoteAddress: '127.0.0.1' } };
    await app.handle(req, result); return result;
  }
  assert.equal((await call('/sources/vbhn06.pdf', false)).status, 401);
  for (const path of ['/sources/vbhn06.pdf', '/copilot/source/law131.pdf']) {
    const result = await call(path);
    assert.equal(result.status, 302);
    assert.match(result.headers.Location, /^\/__sources\/[a-f0-9]{64}\.pdf$/);
    assert.ok(result.body.length < 1024);
  }
  assert.equal((await call('/sources/vbhn06/' + '0'.repeat(64) + '.pdf')).status, 409);
  assert.equal((await call('/copilot/source/unknown.pdf')).status, 404);
});
