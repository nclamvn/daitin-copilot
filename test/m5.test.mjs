import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';

process.env.DAI_TIN_CORPUS_MODE = 'preview';
const { getCatalog, resolveProcedure, search } = await import('../research.mjs');
const { createCopilot } = await import('../copilot/service.mjs');
const { createResearch } = await import('../copilot/m5/research.mjs');
const { createTemplates } = await import('../copilot/m5/templates.mjs');

const catalog = getCatalog();
const actor = { name: 'test-lawyer', group: 'trademark', role: 'reviewer' };
const editor = { name: 'test-editor', group: 'trademark', role: 'editor' };
const input = { anonymized: true };
function withResearch(t) {
  const db = new DatabaseSync(':memory:');
  const templates = createTemplates(db);
  const copilot = createCopilot(catalog, resolveProcedure);
  const research = createResearch({ catalog, search, review: copilot.review, templates });
  t.after(() => { db.close(); copilot.close(); });
  return { templates, ask: (question, fields) => research({ ...input, ...fields, question }, actor) };
}

test('M5 reads explicit date roles without interpreting an unlabeled date', t => {
  const { ask } = withResearch(t);
  assert.equal(ask('Gia hạn nhãn hiệu dùng mẫu nào ngày 01/07/2026?').status, 'needs_context');
  const lookup = ask('Gia hạn nhãn hiệu dùng mẫu nào nếu dự kiến nộp ngày 1/7/2026?');
  assert.equal(lookup.form.id, 'renewal-tt20-01');
  assert.equal(lookup.fields.asOf, '2026-07-01');
  assert.match(lookup.form.snapshotUrl, /\/[a-f0-9]{64}\.pdf#page=5$/);
});

test('M5 stops on disputed or inconsistent dates and keeps distinct roles', t => {
  const { ask } = withResearch(t);
  const renewal = 'Gia hạn nhãn hiệu dùng mẫu nào khi dự kiến nộp ngày 30/06/2026?';
  assert.equal(ask(renewal, { asOf: '2026-07-01' }).status, 'needs_review');
  const answer = ask('Dùng căn cứ nào để phản hồi thông báo thẩm định, tiếp nhận ngày 2026-06-27, đối chiếu ngày 2026-07-02?');
  assert.equal(answer.fields.receivedOn, '2026-06-27');
  assert.deepEqual(answer.missing, ['pendingAtCutover']);
  assert.equal(answer.proofId, undefined);
  assert.equal(ask('Phản hồi thông báo thẩm định. Chưa tiếp nhận ngày 2026-06-27. Đối chiếu ngày 2026-07-02?').status, 'needs_review');
});

test('M5 sends Madrid designations to WIPO with no inferred status', t => {
  const { ask } = withResearch(t);
  const result = ask('Madrid chỉ định Việt Nam và Thái Lan, tình trạng bảo hộ thế nào?');
  assert.equal(result.status, 'referral');
  assert.deepEqual(result.referral.targets.map(item => [item.code, item.status]), [['VN', 'Chưa xác minh'], ['TH', 'Chưa xác minh']]);
  assert.equal(new URL(result.referral.url).hostname, 'www.wipo.int');
  assert.equal(result.form, null);
  assert.equal(result.proofId, undefined);
});

test('M5 template publish binds version, digest, reviewer and previous edition', t => {
  const { templates, ask } = withResearch(t);
  const question = 'Dùng văn bản gì để phản hồi thông báo thẩm định nhãn hiệu?';
  const facts = { mode: 'case', receivedOn: '2026-09-20', asOf: '2026-10-12' };
  const initial = ask(question, facts);
  const base = initial.template.digest;
  const revision = templates.stage(editor, { base, title: 'Phiếu rà soát M5', text: 'Kiểm vị trí nguồn đã chọn.' });
  const own = templates.stage(actor, { base, title: 'Phiếu cần người khác duyệt', text: 'Kiểm ngày đã chọn.' });
  assert.throws(() => templates.change(actor, 'publish', { base, version: own.version, digest: own.digest }), { status: 409 });
  assert.throws(() => templates.change(actor, 'rollback', { base, version: revision.version, digest: revision.digest }), { status: 409 });
  assert.equal(ask(question, facts).proofId, initial.proofId);
  templates.change(actor, 'publish', { base, version: revision.version, digest: revision.digest });
  assert.notEqual(ask(question, facts).proofId, initial.proofId);
  assert.equal(templates.current('other-team').version, 1);
  assert.throws(() => templates.change(actor, 'publish', { base: revision.digest, version: own.version, digest: own.digest }), { status: 409 });
  templates.change(actor, 'rollback', { base: revision.digest, version: 1, digest: base });
  assert.equal(ask(question, facts).proofId, initial.proofId);
});
