import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAdvice } from '../advice/service.mjs';
import { planEmail } from '../advice/email/plan.mjs';
import { applyPlan, finalMail, suggestMail } from '../advice/ui/email.mjs';
import { emailCases } from '../advice/email/cases.mjs';

test('mail intake leaves explicit new matters unselected and flags cross-procedure follow-ups', () => {
  assert.equal(suggestMail('Đăng ký nhãn hiệu tại Việt Nam cần biểu mẫu nào?').topic, '');
  assert.equal(suggestMail('For the Thai patent application, what documents are required?').topic, '');
  assert.equal(suggestMail('Nộp niên phí sáng chế cần hồ sơ gì?', { topic: 'vn-renewal' }).topic, '');
  assert.equal(suggestMail('Bổ sung thời hạn nộp', { topic: 'th-annuity' }).topic, 'th-annuity');
});

test('email update invalidates only changed sections and keeps the previous reviewed version', () => {
  for (const fixture of emailCases) {
    const input = suggestMail(fixture.first);
    assert.equal(input.topic, fixture.topic);
    const first = applyPlan(undefined, fixture.first, input, planEmail(input));
    assert.equal(finalMail(first, 'Thủ tục', false), '');
    for (const section of first.sections) {
      section.draft += ' [Đã rà phiên 1]';
      section.approved = true;
    }
    const revised = suggestMail(fixture.next, input);
    const second = applyPlan(first, fixture.next, revised, planEmail(revised));
    assert.equal(second.id, first.id);
    assert.equal(second.version, 2);
    assert.equal(second.sourceVersion, first.sourceVersion);
    assert.deepEqual(second.sections.map(section => section.id), fixture.expected);
    assert.deepEqual(second.sections.filter(section => !section.approved).map(section => section.id), fixture.changes);
    assert.deepEqual(second.history[0].sections, first.sections);
    assert.equal(finalMail(second, 'Thủ tục', false), '');
    for (const section of second.sections) {
      if (!section.approved) section.approved = true;
      else assert.match(section.draft, /Đã rà phiên 1/);
    }
    assert.ok(finalMail(second, 'Thủ tục', false));
    const pending = second.sections.find(section => section.pending);
    if (pending) {
      assert.ok(finalMail(second, 'Thủ tục', true).includes(pending.draft));
      assert.ok(!finalMail(second, 'Thủ tục', false).includes(pending.draft));
    }
  }
});

test('email planning accepts only structured selections and keeps role checks', async () => {
  const handler = createAdvice({ origin: 'https://example.test' }, {
    VERCEL: '1', DAI_TIN_ADVICE_MODE: 'demo', DAI_TIN_ADVICE_RAG: '1', DAI_TIN_MODEL_MODE: 'disabled',
  });
  const request = (actor, body) => handler({ method: 'POST' }, '/api/advice/email-plan', actor, async () => body);
  const reviewer = { role: 'reviewer', name: 'tester', group: 'test' };
  const fields = { topic: 'th-annuity', fields: ['fee'], year: 8 };
  assert.equal((await request(null, fields)).status, 401);
  assert.equal((await request({ role: 'editor' }, fields)).status, 403);
  for (const body of [{ ...fields, email: 'do not send raw mail' }, { ...fields, year: 21 },
    { ...fields, fields: ['fee', 'fee'] }, { ...fields, topic: 'unknown' }]) {
    assert.equal((await request(reviewer, body)).status, 400);
  }
  const { value } = await request(reviewer, fields);
  assert.match(value.sections[0].text, /2\.200 THB/);
  assert.match(value.sourceVersion, /^[a-f0-9]{64}$/);
  const future = planEmail({ topic: 'vn-renewal', fields: ['fee'], filingYear: 2027 });
  assert.equal(future.sections[0].pending, true);
  assert.doesNotMatch(future.sections[0].text, /50\.000/);
});
