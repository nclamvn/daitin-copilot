import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blindPilot, pilotOrder, reportPilot } from '../advice/ui/pilot-rules.mjs';
import { planEmail } from '../advice/email/plan.mjs';
import { suggestMail } from '../advice/ui/email.mjs';
import { pilotCases } from '../advice/email/m18-cases.mjs';

test('quoted history cannot change the inferred scope or reintroduce an old fee year', () => {
  for (const id of ['V01', 'V06', 'T01', 'T05']) {
    const fixture = pilotCases.find(row => row.id === id);
    const oldInput = suggestMail(fixture.first);
    const input = suggestMail(fixture.next, oldInput);
    const plan = planEmail(input);
    assert.equal(input.topic, fixture.topic);
    assert.deepEqual(plan.sections.map(section => section.id), fixture.expected[1]);
    assert.deepEqual(plan.sections.filter(section => section.pending).map(section => section.id), fixture.pending[1]);
  }
  assert.equal(planEmail({ topic: 'vn-renewal', fields: ['fee'], customer: 'private email' }), null);
});

test('M18 report separates masked outputs, fallbacks, waiting time and paired active time', () => {
  const state = { days: [], entries: [] };
  for (let i = 1; i <= 10; i++) state.days.push({ eligible: 3, started: 2 + (i % 2), fallback: 0 });
  for (let i = 1; i <= 12; i++) {
    const caseId = 'C' + String(i).padStart(2, '0');
    for (const arm of pilotOrder(caseId)) state.entries.push({ caseId, arm, code: caseId + arm[0] + arm.length,
      outcome: i === 12 && arm === 'chatbot' ? 'fallback' : 'done', activeMs: arm === 'chatbot' ? 69 : 100,
      waitMs: 900, draft: { client: 'Kiểm thử', partner: '' }, evidence: ['đoạn 1'] });
  }
  assert.deepEqual(pilotOrder('C02'), ['current', 'chatbot']);
  const masked = blindPilot(state.entries);
  assert.equal(masked.submissions.length, 23);
  assert.ok(masked.submissions.every(row => !Object.hasOwn(row, 'arm') && !Object.hasOwn(row, 'activeMs')));
  const decisions = masked.submissions.map(row => ({ code: row.code, correct: true, conditions: true,
    evidence: true, usable: row.code !== 'C11c7', critical: false }));
  const result = reportPilot(state, decisions);
  assert.equal(result.coverage.matched, 10);
  assert.equal(result.coverage.fellBack, 1);
  assert.equal(result.gates.quality, false);
  assert.equal(result.gates.adoption, true);
  assert.equal(result.gates.time, true);
  const product = decisions.find(row => row.code === 'C11c7');
  product.usable = true;
  assert.equal(reportPilot(state, decisions).gates.quality, false);
  decisions.find(row => row.code === 'C10c7').usable = false;
  assert.equal(reportPilot(state, decisions).passed, false);
});
