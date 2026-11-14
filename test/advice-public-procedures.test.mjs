import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerProcedure } from '../advice/public/answer.mjs';
import { cases } from '../advice/public/cases.mjs';

test('public chat gives separate sections, scope-bound evidence and an editable draft for new queries', () => {
  for (const [query, kind, expectedIds, previous] of cases) {
    const result = answerProcedure(query, previous, '2026-11-13');
    assert.equal(result?.kind, kind, query);
    assert.ok(expectedIds.every(id => result.citations.some(row => row.id === id)), query);
    assert.ok(result.sections.every(group => group.ids.every(id => result.citations.some(row => row.id === id))), query);
    assert.ok(result.citations.every(row => row.origin && row.locator && !row.simulated), query);
    assert.match(result.email, /Trân trọng/u);
    assert.doesNotMatch(result.email, /MÔ PHỎNG/u);
  }
});

test('expired Vietnam reductions and multiple Thai years never produce a single guessed fee', () => {
  const expired = answerProcedure('Gia hạn nhãn hiệu Việt Nam lệ phí bao nhiêu?', undefined, '2027-01-01');
  assert.equal(expired.kind, 'missing');
  assert.doesNotMatch(expired.email, /50\.000/);
  const multiple = answerProcedure('Niên phí sáng chế Thái Lan năm thứ 5 đến năm thứ 8, phí bao nhiêu tiền?');
  assert.equal(multiple.kind, 'missing');
  assert.deepEqual(multiple.citations, []);
  assert.equal(answerProcedure('Niên phí petty patent Thái Lan phí năm thứ 5 bao nhiêu?'), null);
  assert.equal(answerProcedure('Vậy ở Singapore thì hạn nộp sao?', ['vn','tm','renew','poa']), null);
});
