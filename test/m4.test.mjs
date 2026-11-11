import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createDraftModel } from '../copilot/m3/workflow.mjs';

test('M4 giữ phần AI tự viện dẫn để luật sư xác nhận', async t => {
  const scratch = mkdtempSync(join(tmpdir(), 'codex-tmp-m4-20261111-'));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const keyFile = join(scratch, 'key');
  writeFileSync(keyFile, 'a'.repeat(64), { mode: 0o600 });
  let modelPayload;
  t.mock.method(globalThis, 'fetch', async (_url, request) => {
    modelPayload = JSON.parse(JSON.parse(request.body).messages[1].content);
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
      response: { text: 'Đề nghị theo Điều 83 khoản 2 điểm b TCVL 2019.', sources: ['update-1'] },
      attachments: { text: 'Dự kiến kèm bảng đối chiếu.', sources: ['update-1'] }
    }) } }] }));
  });
  const model = createDraftModel({ port: 4313, model: 'fake-model', keyFile });
  const result = await model({
    facts: {}, sources: [{ id: 'update-1', label: 'Chỉ dẫn', text: 'Đề nghị sửa tên hàng hóa.' }],
    basis: { citations: [{ id: 'tt10-83-2b', locator: 'Điều 83 khoản 2 điểm b', page: 102 }] },
    targets: ['response', 'attachments'], instruction: 'Cập nhật', fromPDF: true
  });
  assert.deepEqual(modelPayload.legalAnchors, []);
  assert.deepEqual(result.run.held, ['response']);
  assert.equal(result.patch.response.text, '[Luật sư xác nhận]');
  assert.equal(result.patch.attachments.text, 'Dự kiến kèm bảng đối chiếu.');
});
