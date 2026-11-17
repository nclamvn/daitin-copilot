import assert from 'node:assert/strict';
import test from 'node:test';
import { answerChat, buildChatDraft, validChatRequest } from '../advice/chat/service.mjs';
import { composeReviewedMail, reviseDraft } from '../advice/ui/chat-draft.mjs';
import { questions, threads } from '../advice/chat/eval/cases.mjs';

const asOf = '2026-11-18';
const conditions = { asOf };

test('new compound questions respect procedure, reviewed fee year, and evidence limits', async () => {
  for (const fixture of questions) {
    const answer = await answerChat(fixture.question, [], conditions);
    const found = new Set(answer.sections.flatMap(section => section.pending ? ['?'] : section.ids));
    for (const id of fixture.expected) assert.ok(found.has(id), fixture.id + ' requires ' + id);
    for (const id of found) if (id === '?' || /^th-fee-\d+$/.test(id)) {
      assert.ok(fixture.expected.includes(id), fixture.id + ' unexpected ' + id);
    }
    if (fixture.expected.join('') === '?') assert.equal(answer.kind, 'missing', fixture.id);
    if (fixture.id === 'Q29') {
      assert.deepEqual(answer.sections[0].contextClaims.map(claim => claim.ids[0]), ['th-window', 'th-grant']);
      assert.ok(answer.draft.sections[0].pending);
      assert.doesNotMatch(answer.draft.sections[0].text, /60 ngày/);
    }
    for (const section of answer.sections) for (const claim of section.claims ?? []) {
      assert.ok(claim.ids.every(id => answer.citations.some(source => source.id === id && source.quote && source.locator)), fixture.id);
    }
  }
});

test('correction invalidates affected approval and blocks unconfirmed fee from export', async () => {
  const thread = threads[0];
  const first = await answerChat(thread.first, [], conditions);
  const initial = reviseDraft(null, first.draft);
  initial.sections.forEach(section => { section.approved = true; });
  initial.sections[0].draft = 'Bản đã sửa để gửi khách.';
  const next = await answerChat(thread.next, initial.inputs, conditions);
  const revised = reviseDraft(initial, next.draft);
  assert.equal(revised.sections[0].approved, true);
  assert.equal(revised.sections[0].draft, initial.sections[0].draft);
  assert.equal(revised.sections[1].approved, false);
  assert.match(revised.history[0].sections[1].draft, /2\.200 THB/);
  assert.match(revised.sections[1].draft, /6\.600 THB/);
  assert.equal(composeReviewedMail(revised, false), '');
  revised.sections[1].approved = true;
  assert.match(composeReviewedMail(revised, false), /6\.600 THB/);
  const reconsider = await answerChat('Cập nhật: chưa chốt năm.', revised.inputs, conditions);
  assert.equal(reconsider.draft.inputs[0].year, null);
  assert.equal(reconsider.draft.sections.find(section => section.id.endsWith(':fee')).pending, true);
});

test('a fact-only correction updates the existing draft without expanding its scope', async () => {
  const first = await answerChat('Gia hạn nhãn hiệu Việt Nam cần biểu mẫu nào? Niên phí sáng chế Thái Lan năm thứ 8, phí cơ quan bao nhiêu?', [], conditions);
  const previous = reviseDraft(null, first.draft);
  previous.sections.forEach(section => { section.approved = true; });
  let calls = 0;
  const model = async ({ clauses }) => {
    calls++;
    const fields = /mang theo/.test(clauses[0].text) ? ['documents'] : ['documents', 'term'];
    return { output: { issues: [{ clause: 1, fields, poa: 'requirement' }] } };
  };
  const correction = await answerChat('Đính chính hồ sơ mô phỏng: niên phí sáng chế Thái Lan chốt năm thứ 12.', previous.inputs,
    { asOf, model });
  const updated = reviseDraft(previous, correction.draft);
  assert.equal(calls, 0);
  assert.deepEqual(updated.sections.map(section => [section.id, section.approved]),
    [['vn-renewal:documents', true], ['th-annuity:fee', false]]);
  assert.match(updated.sections[1].draft, /6\.600 THB/);
  const expanded = await answerChat('Cập nhật niên phí sáng chế Thái Lan năm thứ 12, nhờ cho biết giấy nào cần mang theo.',
    previous.inputs, { asOf, model });
  assert.equal(calls, 1);
  assert.deepEqual(expanded.draft.sections.map(section => section.id),
    ['vn-renewal:documents', 'th-annuity:documents', 'th-annuity:fee']);
});

test('model cannot add a fee without a financial request, cite invented text or cross scope', async () => {
  const model = async () => ({ output: { issues: [{ clause: 1, fields: ['fee'], poa: 'requirement', answer: 'Tự tạo lệ phí 123.' }] } });
  const a = await answerChat('Niên phí sáng chế Thái Lan năm thứ 8, thời hạn thế nào?', [], { asOf, model });
  assert.ok(a.draft.sections.every(section => !section.id.endsWith(':fee')));
  assert.doesNotMatch(JSON.stringify(a), /Tự tạo lệ phí/);
  let calls = 0;
  const b = await answerChat('Niên phí giải pháp hữu ích Thái Lan năm thứ 8 tốn bao nhiêu?', [], { asOf, model: () => { calls++; } });
  assert.equal(b.kind, 'missing');
  assert.equal(calls, 0);
  assert.equal(validChatRequest({ query: 'Thử', previous: [], sources: [{ id: 'invented' }] }), false);
});

test('pending conflict and source replacement survive the draft recheck', async () => {
  const first = await answerChat('Gia hạn nhãn hiệu Việt Nam cần POA và biểu mẫu gì?', [], conditions);
  const old = reviseDraft(null, first.draft);
  old.sections.forEach(section => { section.approved = true; });
  const source = { id: 'test-partner-poa', scope: ['vn', 'tm', 'renew', 'poa'], title: 'Tình huống mô phỏng',
    quote: 'Hãng cho rằng không cần POA khi qua đại diện.', statement: 'Hãng cho rằng không cần POA khi qua đại diện.',
    issuer: 'test-partner', value: 'none', reviewed: true, date: '2026-11-17', supersedes: [], kind: 'email', paragraph: 1 };
  const unseen = buildChatDraft(old.inputs, [{ ...source, reviewed: false }], asOf);
  assert.equal(unseen.sourceVersion, old.sourceVersion);
  const latest = reviseDraft(old, buildChatDraft(old.inputs, [source], asOf));
  assert.equal(latest.sections[0].approved, true);
  assert.equal(latest.sections[1].approved, false);
  assert.equal(latest.sections[1].pending, true);
  assert.match(latest.sections[1].draft, /khác nhau/);
  assert.notEqual(latest.sourceVersion, old.sourceVersion);
});
