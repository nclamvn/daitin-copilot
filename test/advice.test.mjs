import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerAdvice, prompts } from '../advice/engine.mjs';
import { demoWord, simulatedMail } from '../advice/demo.mjs';
import { createAdvice } from '../advice/service.mjs';

const ask = (question, scenario = 'word') => answerAdvice(question, demoWord, simulatedMail, scenario);

test('M9 trả lời đúng phạm vi cho câu POA gia hạn nhãn hiệu Việt Nam', () => {
  for (const query of [prompts[0], 'Ở Việt Nam, gia hạn nhãn hiệu cần giấy uỷ quyền không?',
    'Is a power of attorney required for Vietnam trademark renewal?']) {
    const result = ask(query);
    assert.equal(result.kind, 'supported');
    assert.equal(result.emailKind, 'reply');
    assert.match(result.email, /hồ sơ gia hạn nhãn hiệu/);
    assert.deepEqual(result.citations.map(row => row.id), ['word-vn-renewal']);
  }
});

test('M9 dừng cho niên phí sáng chế Thái Lan khi Word chỉ có POA vào giai đoạn PCT', () => {
  const result = ask('Nộp niên phí sáng chế ở Thái Lan có cần POA không?');
  assert.equal(result.kind, 'missing');
  assert.equal(result.emailKind, 'verification');
  assert.equal(result.citations[0].state, 'context');
  assert.equal(result.citations[0].id, 'word-th-registration');
  assert.match(result.email, /Nhờ anh\/chị xác nhận/);
  assert.doesNotMatch(result.email, /cần công chứng|phải công chứng/);
});

test('M9 từ chối sai quốc gia, thủ tục, câu ghép và chi tiết chưa có căn cứ', () => {
  for (const query of [
    'Trademark Renewal in Thailand có cần POA không?',
    'Patent Annuity in Vietnam có cần POA không?',
    'Utility Model / Patent Annuity in Thailand có cần POA không?',
    'PCT national phase hoặc Patent Annuity in Thailand có cần POA không?',
    'Gia hạn kiểu dáng tại Việt Nam có cần POA không?',
    prompts.join(' '),
    'Trademark Renewal in Vietnam có cần công chứng POA không?',
    'Vietnam trademark renewal reuse existing POA?',
    'Cần POA không?',
  ]) {
    const result = ask(query, 'updated');
    assert.equal(result.kind, 'missing', query);
    assert.equal(result.citations.length, 0, query);
    assert.equal(result.email, '', query);
  }
});

test('M9 hiển thị đoạn cũ khi email mới ghi rõ bản bị thay thế', () => {
  const result = ask(prompts[0], 'updated');
  assert.equal(result.kind, 'supported');
  assert.deepEqual(result.citations.map(row => [row.id, row.state]), [
    ['sim-update-vn', 'active'], ['word-vn-renewal', 'superseded'],
  ]);
  assert.match(result.body, /giữ nguyên đại diện và POA còn hiệu lực/);
  assert.match(result.email, /^\[MÔ PHỎNG/);
  const thai = ask(prompts[1], 'updated');
  assert.equal(thai.kind, 'supported');
  assert.match(thai.body, /qua hãng đại diện nêu trong email/);
  assert.equal(thai.citations[1].state, 'context');
});

test('M9 giữ mâu thuẫn khi email mới không thay thế rõ bản cũ hoặc có ngày không hợp lệ cho việc thay thế', () => {
  for (const question of prompts) {
    const result = ask(question, 'conflict');
    assert.equal(result.kind, 'conflict');
    assert.equal(result.emailKind, 'verification');
    assert.equal(result.citations.filter(row => row.state === 'active').length, 2);
    assert.match(result.email, /hướng dẫn nào đang áp dụng/);
    assert.match(result.email, /^\[MÔ PHỎNG/);
  }
  const updated = simulatedMail.updated[0];
  const datedWord = [{ ...demoWord[0], date: updated.date }];
  assert.equal(answerAdvice(prompts[0], datedWord, simulatedMail, 'updated').kind, 'conflict');
  const unrelated = [{ ...updated, supersedes: ['word-th-registration'] }];
  assert.equal(answerAdvice(prompts[0], demoWord, { updated: unrelated }, 'updated').kind, 'conflict');
});

test('M9 chỉ cho phép kích hoạt Word trên web xác thực nội bộ loopback', () => {
  assert.throws(() => createAdvice({ origin: 'https://example.test' }, {
    VERCEL: '1', DAI_TIN_BIND: '127.0.0.1',
  }), /loopback/);
  assert.throws(() => createAdvice({ origin: 'http://127.0.0.1:4339' }, {
    DAI_TIN_BIND: '0.0.0.0',
  }), /loopback/);
  assert.throws(() => createAdvice(null, { DAI_TIN_BIND: '127.0.0.1' }), /xác thực/);
});

test('M9 Vercel chỉ trả nguồn mô phỏng, vẫn yêu cầu đúng quyền', async () => {
  const handle = createAdvice({ origin: 'https://example.test' }, {
    VERCEL: '1', DAI_TIN_ADVICE_MODE: 'demo',
    DAI_TIN_ADVICE_WORD: '/private/word.json', DAI_TIN_ADVICE_REVIEW: '/private/review.json',
  });
  const reviewer = { role: 'reviewer' };
  const get = { method: 'GET' };
  const ask = question => handle({ method: 'POST' }, '/api/advice/ask', reviewer,
    async () => ({ query: question, scenario: 'word' }));
  assert.equal((await handle(get, '/api/advice/config', null)).status, 401);
  assert.equal((await handle(get, '/api/advice/config', { role: 'editor' })).status, 403);
  assert.equal((await handle(get, '/api/advice/config', reviewer)).value.label, 'Dữ liệu mô phỏng');
  for (const [question, kind] of [[prompts[0], 'supported'], [prompts[1], 'missing']]) {
    const { value } = await ask(question);
    assert.equal(value.kind, kind);
    assert.equal(value.simulation, true);
    assert.ok(value.citations.length && value.citations.every(item => item.simulated));
    assert.match(value.email, /^\[MÔ PHỎNG/);
  }
});
