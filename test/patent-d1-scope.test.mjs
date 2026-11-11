import assert from 'node:assert/strict';
import test from 'node:test';
import { guardModelD1Scope, newD1ScopeReceipt } from '../patents/d1-scope.mjs';
import { generatePatentProposal } from '../patents/workflow.mjs';

const d1Quote = 'D1 describes a removable barcode label on a storage container.';
const regression = 'D1 mô tả nhãn mã vạch có thể tháo rời trên vật chứa, không đề cập đến mã vạch kép trải qua cả hai phần nhãn.';
const limited = 'Đoạn D1 đã chọn' + regression.slice(2);
const evidence = { record: { id: 'd1-p7', text: d1Quote, title: 'D1', locator: { label: 'Trang 7', page: 7 } },
  source: { publicationIdentifier: 'US5783810A' } };
const matter = { claimText: 'A container with a shared double barcode on two parts of a label.', claimRecordId: null,
  noticeText: 'Thông báo mô phỏng.', instructionsText: 'Xác minh đặc điểm đã chọn.', evidenceIds: ['d1-p7'],
  d1RecordIds: ['d1-p7'], pinnedEvidence: [evidence], sections: { matrix: { rows: [] }, response: { text: '', evidenceIds: [] } } };

test('scopes the actual M7 overstatement in both generated sections without rewriting exact quotations', () => {
  const before = { matrix: { rows: [{ feature: 'Mã vạch kép', analysis: regression, missing: '', d1Quote, claimQuote: matter.claimText }] },
    response: { text: 'Hồ sơ mô phỏng. ' + regression + ' Cần kiểm tra thêm D1 để xác nhận dấu hiệu này.', evidenceIds: ['d1-p7'] } };
  const scope = newD1ScopeReceipt();
  const after = guardModelD1Scope(matter, before, ['matrix', 'response'], scope);
  assert.equal(after.matrix.rows[0].analysis, limited);
  assert.equal(after.matrix.rows[0].d1Quote, d1Quote);
  assert.equal(after.matrix.rows[0].claimQuote, matter.claimText);
  assert.equal(after.response.text, 'Hồ sơ mô phỏng. ' + limited + ' Cần kiểm tra thêm D1 để xác nhận dấu hiệu này.');
  assert.equal(scope.rewrittenSentences, 2);
  assert.deepEqual(guardModelD1Scope(matter, after, ['matrix', 'response']), after);
});

test('response-only scope covers publication IDs, implied subjects and unqualified absences', () => {
  for (const [input, expected] of [
    ['US 5,783,810 does not disclose the shared barcode.', /The selected US 5,783,810 excerpt does not disclose/],
    ['Tài liệu này không đề cập mã vạch kép.', /Trong các đoạn D1 đã chọn: Tài liệu này không đề cập/],
    ['Không tìm thấy mã vạch kép.', /Trong các đoạn D1 đã chọn: Không tìm thấy/],
    ['D1 describes a removable tab. It does not disclose X.', /Within the selected D1 excerpts: It does not disclose/]
  ]) {
    const patch = guardModelD1Scope(matter, { response: { text: input } }, ['response']);
    assert.match(patch.response.text, expected);
    assert.deepEqual(guardModelD1Scope(matter, patch, ['response']), patch);
  }
  const existing = { response: { text: 'Đoạn D1 đã chọn chưa cho thấy mã vạch kép. Cần kiểm tra toàn văn D1.' } };
  assert.deepEqual(guardModelD1Scope(matter, existing, ['response']), existing);
});

test('rejects whole-document and feature-field verdicts, but does not invent a selected D1', () => {
  for (const text of [
    'Toàn bộ D1 không có mã vạch kép và cần kiểm tra lại.',
    'D1 never discloses the shared barcode anywhere in the document.',
    'D1 chứng minh yêu cầu không có tính mới.'
  ]) {
    const scope = newD1ScopeReceipt();
    assert.throws(() => guardModelD1Scope(matter, { response: { text } }, ['response'], scope), { status: 422 });
    assert.equal(scope.rejected, true);
  }
  assert.throws(() => guardModelD1Scope(matter, { matrix: { rows: [{ feature: 'D1 không có mã vạch kép.' }] } }, ['matrix']), { status: 422 });
  const unbound = { ...matter, pinnedEvidence: [], d1RecordIds: [] };
  const request = { response: { text: 'Chưa có D1 được chọn. Cần chọn D1 để đối chiếu.' } };
  assert.deepEqual(guardModelD1Scope(unbound, request, ['response']), request);
  assert.throws(() => guardModelD1Scope(unbound, { response: { text: 'D1 has a barcode.' } }, ['response']), { status: 422 });
  assert.throws(() => guardModelD1Scope(unbound, { response: { text: 'Đoạn D1 đã chọn chưa cho thấy dấu hiệu.' } }, ['response']), { status: 422 });
});

test('the provider response-only adapter applies the guard and logs a rejection without storing provider prose', async () => {
  const connection = { model: 'mock', provider: 'fixture', endpoint: 'https://example.test/chat/completions', remote: true,
    credential: async () => 'fixture-secret' };
  const provider = text => async () => Response.json({ choices: [{ finish_reason: 'stop',
    message: { content: JSON.stringify({ response: { text, evidenceIds: ['d1-p7'] } }) } }] });
  const input = { matter, targets: ['response'], instruction: 'Rà soát lại phần phản hồi.' };
  const { patch, run } = await generatePatentProposal(input, { connection, fetcher: provider(regression) });
  assert.equal(patch.response.text, limited);
  assert.equal(run.d1Scope.rewrittenSentences, 1);
  const rejected = 'Toàn bộ D1 không có mã vạch kép.';
  await assert.rejects(generatePatentProposal(input, { connection, fetcher: provider(rejected) }), error => {
    assert.equal(error.status, 422);
    assert.equal(error.modelReceipt.outcome, 'rejected');
    assert.equal(error.modelReceipt.d1Scope.rejected, true);
    assert.equal(JSON.stringify(error.modelReceipt).includes(rejected), false);
    return true;
  });
});
