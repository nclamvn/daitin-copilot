import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

process.env.DAI_TIN_PDF_ENGINE = 'pdfjs';
const { runHumanDirect, verifyHumanSources } = await import('./direct.mjs');
const { loadCases, modelId, readJSON, sha, writeJSON } = await import('./common.mjs');

function onePage(text) {
  const stream = 'BT /F1 10 Tf 20 150 Td (' + text + ') Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Length ' + Buffer.byteLength(stream) + ' >>\nstream\n' + stream + '\nendstream'
  ];
  let pdf = '%PDF-1.7\n';
  const offsets = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += 'xref\n0 6\n0000000000 65535 f \n' + offsets.map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('');
  return Buffer.from(pdf + 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
}

test('real-class direct runner gates both phases on human review and preserves the first Word', async t => {
  const root = mkdtempSync(resolve('work/codex-tmp-direct-mock-20261111-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const actualNow = Date.now.bind(Date);
  t.mock.method(Date, 'now', () => actualNow() + 60000);
  const entry = { id: 'P01', reference: 'DT-HUMAN-MOCK', title: 'Mẫu kiểm thử', asOf: '2026-11-11',
    instructions: 'Rà điều kiện và nguồn.', phase1Task: 'Lập ma trận và phản hồi.',
    phase2Instructions: 'Bổ sung việc cần kiểm trong nguồn.', phase2Task: 'Cập nhật phản hồi.' };
  const excerpts = { notice: 'Compare the activation condition.', claim: 'The latch engages at thirty degrees.',
    d1: 'The arm rotates to forty degrees.' };
  for (const [role, quote] of Object.entries(excerpts)) {
    const file = role + '.pdf';
    const bytes = onePage(quote);
    writeFileSync(join(root, file), bytes, { mode: 0o600 });
    entry[role] = { file, page: 1, quote, sha256: sha(bytes), label: role };
  }
  const manifest = join(root, 'cases.json');
  writeJSON(manifest, { version: 1, synthetic: false, anonymized: true, cases: [entry] });
  const input = loadCases(manifest, 8, { anonymized: true });
  assert.throws(() => loadCases(manifest));
  assert.equal(await verifyHumanSources(input), 3);
  const badExcerpt = structuredClone(input);
  badExcerpt.cases[0].documents[0].quote += ' Extra words.';
  await assert.rejects(verifyHumanSources(badExcerpt), /P01\/notice/);
  const connection = { model: modelId, provider: 'ai-gateway.vercel.sh', remote: true,
    endpoint: 'https://ai-gateway.vercel.sh/v1/chat/completions', credential: async () => 'mock-only' };
  let calls = 0;
  const fetcher = async (_, { body }) => {
    calls++;
    const payload = JSON.parse(body);
    const operator = JSON.parse(payload.messages[1].content);
    const reply = payload.tools ? { finish_reason: 'tool_calls', message: { tool_calls: [{
      id: 'mock-read-' + operator.phase, function: { name: 'read_case',
        arguments: JSON.stringify({ caseId: operator.caseId, phase: operator.phase }) }
    }] } } : {
      finish_reason: 'stop',
      message: { content: JSON.stringify({
        ...(operator.requestedTargets.includes('matrix') ? { matrix: { rows: [{
          feature: 'Điều kiện tác động', claimSpanId: operator.spanOptions.claim[0].id, d1SpanId: operator.spanOptions.d1[0].id,
          assessment: 'uncertain', analysis: 'Đoạn chọn mô tả bộ phận khác.', missing: 'Rà điều kiện tác động.'
        }] } } : {}),
        response: { observed: 'Đối chiếu điều kiện đã chọn.', unresolved: '',
          ...(operator.revisionRequest ? { nextCheck: 'Rà hình minh họa cơ cấu.' } : { text: 'Rà tên bộ phận.' }),
          evidenceIds: ['pdf-claim', 'pdf-d1', 'case:notice'] }
      }) }
    };
    return Response.json({ choices: [reply] });
  };
  const go = (phase, answers) => runHumanDirect({ out: root, input, phase, connection, fetcher,
    ask: async () => answers.shift() ?? 'n', show: () => {} });
  const v1 = join(root, 'direct-word', 'P01-v1.docx');
  const v2 = join(root, 'direct-word', 'P01-v2.docx');
  await assert.rejects(go(2, []), /phiên 1/);
  await assert.rejects(go(1, ['y', 'y', 'n']), /giữ bản nháp/);
  assert.equal(calls, 2);
  assert.equal(existsSync(v1), false);
  const review = join(root, 'direct-workspace', 'P01-review-1.json');
  const revised = readJSON(review);
  revised.response.text = 'Phản hồi đã được người vận hành sửa.';
  writeJSON(review, revised);
  await go(1, ['y', 'y']);
  assert.equal(calls, 2);
  assert.equal(existsSync(v1), true);
  const word1 = sha(readFileSync(v1));
  await go(2, ['y', 'y']);
  const ledger = readJSON(join(root, 'direct.json'));
  const [first, second] = [ledger.cases.P01.phases[1], ledger.cases.P01.phases[2]];
  assert.equal(calls, 4);
  assert.equal(ledger.syntheticOnly, false);
  assert.equal(ledger.humanReview, 'operator_attested');
  assert.equal(ledger.humanActiveMs, null);
  assert.equal(first.quality.response.text, revised.response.text);
  assert.deepEqual(first.approvals.matrix, second.approvals.matrix);
  assert.equal(second.approvals.response.by.name, 'binh');
  assert.equal(second.quality.matrixPreserved, true);
  assert.equal(second.quality.word1Preserved, true);
  assert.equal(sha(readFileSync(v1)), word1);
  assert.notEqual(sha(readFileSync(v2)), word1);
  writeFileSync(v1, 'changed');
  await assert.rejects(go(1, ['y']), /Dấu kiểm/);
  assert.equal(calls, 4);
});
