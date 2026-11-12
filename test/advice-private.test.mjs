import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openPrivateStore } from '../advice/private/store.mjs';
import { createAdvice } from '../advice/service.mjs';
import { scopeOf } from '../advice/library/retrieval.mjs';
import { libraryAnswer } from '../advice/library/answer.mjs';

test('private approval gates raw file, paragraph and append-only approval digest', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'codex-tmp-daitin-m11-' + new Date().toISOString().slice(0, 10).replaceAll('-', '') + '-'));
  const store = openPrivateStore(directory);
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  const source = readFileSync(new URL('../advice/library/fixtures/vn-renew-poa.docx', import.meta.url));
  const payload = { name: 'example.docx', owner: 'Đội kiểm thử', permission: 'Cho phép kiểm tra mô phỏng.',
    base64: source.toString('base64'), allowed: true };
  await assert.rejects(store.importFile({ ...payload, allowed: false }, 'editor'), /quyền sử dụng/);
  const imports = await Promise.all([store.importFile(payload, 'editor'), store.importFile(payload, 'editor')]);
  assert.equal(imports.filter(item => item.duplicate).length, 1);
  const { sha } = imports[0];
  assert.equal(store.publish().rows.length, 0);
  const part = store.document(sha).paragraphs.find(row => row.paragraph === 3);
  const data = { sha, paragraph: 3, digest: part.digest, confirmed: true, scope: ['vn', 'tm', 'renew', 'poa'],
    value: 'signed', issuer: 'fixture', statement: 'Cần giấy ủy quyền có chữ ký theo bộ mẫu.' };
  assert.throws(() => store.approve({ ...data, digest: '0'.repeat(64) }, 'lawyer'), /Đoạn đã đổi/);
  const { id } = store.approve(data, 'lawyer');
  const approved = store.publish();
  assert.notEqual(approved.version, '0'.repeat(64));
  assert.equal(approved.rows.length, 1);
  assert.deepEqual(store.file(id).bytes, source);
  const answer = await libraryAnswer(approved.index, 'Gia hạn nhãn hiệu Việt Nam có cần POA?', 'library', null, { simulation: false });
  assert.equal(answer.kind, 'supported');
  assert.equal(answer.simulation, false);
  assert.equal(answer.email, '');
  assert.match(answer.notes.at(-1), /chưa có nội dung đã duyệt/);
  assert.throws(() => store.db.prepare('UPDATE activity SET actor=?').run('different'), /immutable activity/);
  store.db.prepare('UPDATE review SET data=? WHERE id=?').run(JSON.stringify({ ...approved.rows[0], statement: 'Đoạn đã bị can thiệp.' }), id);
  assert.throws(() => store.publish(), /lệch nhật ký/);
  store.db.prepare('UPDATE review SET data=? WHERE id=?').run(JSON.stringify(approved.rows[0]), id);
  store.db.prepare('UPDATE intake SET bytes=? WHERE sha=?').run(Buffer.from('wrong'), sha);
  assert.throws(() => store.publish(), /lệch dấu kiểm/);
});

test('official form question maps to the approved documents facet', () => {
  assert.deepEqual(scopeOf('Tờ khai gia hạn nhãn hiệu Việt Nam dùng mẫu nào?'), ['vn', 'tm', 'renew', 'documents']);
});

test('real library rejects Vercel and remote model endpoints before touching storage', () => {
  const env = { DAI_TIN_ADVICE_MODE: 'private', DAI_TIN_BIND: '127.0.0.1' };
  assert.throws(() => createAdvice({ origin: 'https://example.test' }, { ...env, VERCEL: '1' }), /loopback/);
  assert.throws(() => createAdvice({ origin: 'http://127.0.0.1:4342' }, { ...env,
    DAI_TIN_MODEL_ENDPOINT: 'https://example.test/chat/completions' }), /model loopback/);
});
