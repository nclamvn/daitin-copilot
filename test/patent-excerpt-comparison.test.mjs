import assert from 'node:assert/strict';
import test from 'node:test';
import { hash } from '../copilot/m3/workflow.mjs';
import { comparePatentExcerpts } from '../patents/excerpt-comparison.mjs';
import { buildPatentPrompt, generatePatentProposal, materializePatentSpans } from '../patents/workflow.mjs';

const connection = { model: 'fixture-model', provider: 'fixture', endpoint: 'https://example.test/chat/completions', remote: true,
  credential: async () => 'fixture-key' };

function matterWith(claim, d1) {
  const pin = (id, text) => ({
    record: { id, text, locator: { page: id === 'claim' ? 1 : 2 } },
    source: { kind: 'case_document', sha256: hash('source:' + id + ':' + text) }
  });
  return { claimText: claim, claimRecordId: 'claim', noticeText: 'Kiểm tra thông số trong đoạn đã chọn.',
    instructionsText: 'Ghi riêng giá trị, đơn vị và điều kiện tác động.', evidenceIds: ['claim', 'd1'], d1RecordIds: ['d1'],
    pinnedEvidence: [pin('claim', claim), pin('d1', d1)],
    sections: { matrix: { rows: [], approval: null }, response: { text: '', evidenceIds: [], approval: null } } };
}

const provider = draft => async (_url, options) => Response.json({ choices: [{ finish_reason: 'stop',
  message: { content: JSON.stringify(draft(JSON.parse(options.body))) } }] });
const contraryResponse = { observed: 'Đoạn D1 đã chọn chưa cho thấy thông số trong yêu cầu.',
  unresolved: 'Chưa tìm được giá trị.', text: 'Việc cần kiểm: Đối chiếu điểm kích hoạt trên sơ đồ tín hiệu.', evidenceIds: ['case:notice'] };
const absentRow = options => ({ feature: 'Điều kiện tác động', claimSpanId: options.claim[0].id,
  d1SpanId: null, assessment: 'not_found', analysis: 'Chưa thấy điều kiện trong đoạn D1 đã chọn.', missing: 'Cần thêm nguồn.' });

test('literal match rescues omitted D1 binding and wrong inference in both sections, with exact offset receipts', async () => {
  const source = 'The thermostat closes after 7 seconds above 64 °C.';
  const matter = matterWith(source, source);
  const input = { matter, targets: ['matrix', 'response'] };
  const fetcher = provider(payload => {
    const { spanOptions } = JSON.parse(payload.messages[1].content);
    return { matrix: { rows: [absentRow(spanOptions)] }, response: contraryResponse };
  });
  const { patch, run } = await generatePatentProposal(input, { connection, fetcher });
  const row = patch.matrix.rows[0];
  assert.equal(row.assessment, 'disclosed');
  assert.equal(row.claimQuote, source);
  assert.equal(row.d1Quote, source);
  assert.match(row.analysis, /sau 7 giây, trên 64 °C/);
  assert.match(patch.response.text, /sau 7 giây, trên 64 °C/);
  assert.match(patch.response.text, /sơ đồ tín hiệu/);
  assert.doesNotMatch(patch.response.text, /Chưa tìm được giá trị/);
  assert.deepEqual(patch.response.evidenceIds, ['claim', 'd1', 'case:notice']);
  assert.equal(run.selectedSpans[0].d1, null);
  const validated = run.excerptComparison.validatedSpans[0].d1;
  assert.equal(source.slice(validated.start, validated.end), row.d1Quote);
  assert.equal(validated.recordSHA256, hash(source));
  assert.equal(validated.sourceSHA256, matter.pinnedEvidence[1].source.sha256);
});

test('different aligned comparator, value and exclusive state retain exact source conditions', () => {
  const conditions = comparePatentExcerpts('A sensor signals above 15.5 kPa.', 'A sensor signals at least 19.5 kPa.');
  assert.equal(conditions.assessment, 'different');
  assert.match(conditions.observed, /trên 15.5 kPa.*ít nhất 19.5 kPa/);
  assert.equal(comparePatentExcerpts('A sensor signals above 15.50 kPa.', 'A sensor signals over 15.5 kPa.'), null);
  assert.equal(comparePatentExcerpts('A sensor signals above 15.5 kPa.', 'A sensor signals above 15.5 Pa.'), null);
  const state = comparePatentExcerpts('The shutter closes only if the fan is on.', 'The shutter closes only if the fan is off.');
  assert.equal(state.assessment, 'different');
  assert.match(state.observed, /chỉ khi ở trạng thái bật.*chỉ khi ở trạng thái tắt/);
  assert.equal(comparePatentExcerpts('The shutter closes only if the fan is on.', 'The shutter closes if the fan is on.'), null);
  assert.equal(comparePatentExcerpts('The shutter does not close only if the fan is on.', 'The shutter does not close only if the fan is off.'), null);
});

test('bit to byte conversion preserves field position and does not smooth over different widths', () => {
  const left = 'The message ends with a three-byte parity field.';
  const right = 'The last field of the message is a 24-bit parity.';
  const relation = comparePatentExcerpts(left, right);
  assert.equal(relation.kind, 'equivalent_binary_units');
  assert.match(relation.observed, /24 bit ÷ 8 = 3 byte, giữ nguyên vị trí trường cuối/);
  assert.equal(comparePatentExcerpts(left, right.replace('last field', 'first field')), null);
  assert.equal(comparePatentExcerpts(left, right.replace('24-bit', '32-bit')), null);
});

test('compound evidence keeps shared measure and unresolved condition distinct, with native narrowed spans', async () => {
  const claim = 'A capsule has 24-micrometer slots and can be inserted without adhesive.';
  const d1 = 'A capsule has 24-micrometer slots and sits in an interchangeable sleeve.';
  const matter = matterWith(claim, d1);
  const fetcher = provider(payload => {
    const { spanOptions } = JSON.parse(payload.messages[1].content);
    return { matrix: { rows: [absentRow(spanOptions)] }, response: contraryResponse };
  });
  const { patch, run } = await generatePatentProposal({ matter, targets: ['matrix', 'response'] }, { connection, fetcher });
  assert.deepEqual(patch.matrix.rows.map(row => row.assessment), ['disclosed', 'uncertain']);
  assert.match(patch.response.text, /24-micrometer slots/);
  assert.match(patch.response.text, /without adhesive.*interchangeable sleeve.*chưa xác nhận/);
  for (const [index, row] of patch.matrix.rows.entries()) {
    const spans = run.excerptComparison.validatedSpans[index];
    assert.equal(claim.slice(spans.claim.start, spans.claim.end), row.claimQuote);
    assert.equal(d1.slice(spans.d1.start, spans.d1.end), row.d1Quote);
    assert.ok(spans.claim.id.endsWith('-0-' + row.claimQuote.length));
    assert.ok(spans.d1.id.endsWith('-0-' + row.d1Quote.length));
  }
  assert.equal(comparePatentExcerpts(claim, d1.replace('and sits', 'or sits')), null);
});

test('similar subject, adjacent function or timing alone remains unresolved by code', () => {
  for (const [claim, d1] of [
    ['Each duct has a separately operated gate.', 'The panel has three parallel ducts.'],
    ['A flexible bladder keeps pressure constant.', 'A perforated mesh catches particles.'],
    ['Moving the slider energizes the infrared source.', 'A red lamp flashes after the slider moves.'],
    ['The actuator reaches 73 C?', 'The actuator reaches 73 C.']
  ]) assert.equal(comparePatentExcerpts(claim, d1), null);
});

test('revision promotes the current request after stale prose and separates a named future inspection', async () => {
  const claim = 'A keyed coupling cannot rotate after the retaining key seats in the groove.';
  const d1 = 'The coupling connects the shaft and the drive wheel.';
  const matter = matterWith(claim, d1);
  matter.instructionsText = 'Chỉ ra chi tiết ngồi rãnh của then giữ cần xem trong hình tách cụm khớp nối.';
  matter.sections.matrix = { approval: { sha256: 'old-matrix' }, rows: [{ feature: 'Chặn xoay khớp nối', claimQuote: claim,
    d1Quote: d1, d1RecordId: 'd1', assessment: 'uncertain', analysis: 'Đoạn đã chọn ghi hai bộ phận kết nối.', missing: 'Chưa xác nhận cơ cấu giữ.' }] };
  const observed = 'Đoạn D1 đã chọn ghi khớp nối giữa trục và bánh dẫn động.';
  matter.sections.response.text = 'Đối chiếu đoạn đã chọn: ' + observed + '\n\nBản cũ đề nghị kiểm trục.';
  const before = structuredClone(matter.sections.matrix);
  const input = { matter, targets: ['response'], instruction: 'Chỉ cập nhật phản hồi theo chỉ dẫn hiện hành.' };
  const prompt = buildPatentPrompt(input, connection);
  const context = JSON.parse(prompt.messages[1].content);
  assert.deepEqual(context.requestedTargets, ['response']);
  assert.equal(Object.keys(context).at(-1), 'revisionRequest');
  assert.equal(context.revisionRequest.operatorTask, input.instruction);
  assert.equal(context.revisionRequest.currentInstructions.text, matter.instructionsText);
  assert.equal(context.revisionRequest.currentInstructions.sha256, hash(matter.instructionsText));
  assert.ok(!context.privateCaseEvidence.some(item => item.id === 'case:instructions'));
  assert.equal(context.matrixContext.rows[0].d1Quote, d1);
  assert.equal(context.draftForReference.response.text, matter.sections.response.text);
  assert.deepEqual(prompt.response_format.json_schema.schema.properties.response.required, ['observed', 'unresolved', 'nextCheck', 'evidenceIds']);
  const raw = { response: { observed,
    unresolved: 'Đoạn đã chọn chưa xác nhận then giữ chặn xoay.',
    nextCheck: 'Đối chiếu đoạn đã chọn: ' + observed.normalize('NFD').replaceAll(' ', '  ') +
      '\r\n\r\nViệc cần kiểm: Xem hình tách cụm khớp nối để kiểm tra then giữ có ngồi trong rãnh và chặn xoay hay không.',
    evidenceIds: ['claim', 'd1', 'case:instructions'] } };
  const direct = materializePatentSpans(raw, context.spanOptions);
  let calls = 0;
  const fetcher = provider(payload => {
    calls++;
    assert.equal(JSON.parse(payload.messages[1].content).revisionRequest.currentInstructions.text, matter.instructionsText);
    return raw;
  });
  const { patch } = await generatePatentProposal(input, { connection, fetcher });
  assert.equal(calls, 1);
  assert.deepEqual(matter.sections.matrix, before);
  assert.equal(matter.sections.response.text, context.draftForReference.response.text);
  assert.deepEqual(Object.keys(patch), ['response']);
  assert.equal(patch.response.text, direct.response.text);
  assert.equal(patch.response.text.match(/Đối chiếu đoạn đã chọn:/gu).length, 1);
  assert.match(patch.response.text, /Việc cần kiểm: Xem hình tách cụm khớp nối.*then giữ có ngồi trong rãnh/u);
  assert.doesNotMatch(patch.response.text, /Bản cũ|đã xem hình/iu);
});

test('a result-only revision can keep a complete comparator and units without inventing a verification action', async () => {
  const source = 'The compressor stops after 11 seconds below 18 kPa.';
  const matter = matterWith(source, source);
  matter.instructionsText = 'Ghi thời gian và ngưỡng áp suất kèm đơn vị và chiều so sánh trong câu kết quả.';
  matter.sections.response.text = 'Thời gian sau 11 giây và áp suất dưới 18 kPa.';
  const raw = { response: { observed: 'Hai đoạn cùng ghi dừng sau 11 giây khi dưới 18 kPa.', unresolved: '',
    nextCheck: '', evidenceIds: ['claim', 'd1'] } };
  const input = { matter, targets: ['response'] };
  let calls = 0;
  const { patch, run } = await generatePatentProposal(input, { connection, fetcher: provider(() => { calls++; return raw; }) });
  assert.equal(calls, 1);
  assert.equal(run.excerptComparison.responseKind, 'literal_match');
  assert.match(patch.response.text, /sau 11 giây, dưới 18 kPa/u);
  assert.doesNotMatch(patch.response.text, /Việc cần kiểm|Điểm cần xác minh/u);
  assert.deepEqual(Object.keys(patch.response).sort(), ['approval', 'evidenceIds', 'text']);
});
