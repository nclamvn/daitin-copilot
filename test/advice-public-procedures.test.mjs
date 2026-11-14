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

test('Thai annuity asks for one confirmed year before quoting, including alternatives and provisional estimates', () => {
  const prefix = 'Niên phí sáng chế Thái Lan, xin báo phí cơ quan. ';
  for (const detail of [
    'Khách chưa chốt năm thứ 8 hay năm thứ 12.',
    'Chưa rõ là năm thứ 8 hay thứ 12.',
    'Đang xem năm thứ 8 hoặc 12.',
    'Ban đầu dự kiến năm thứ 8. Khách cũng đang xem năm thứ 12.',
    'Năm thứ 8 chưa xác nhận.',
    'Could be year 8 or the 12th year.',
    'Looking at year 8 or 12.',
    'Dự kiến năm thứ 8, chưa chốt.',
    'Có thể là năm thứ 8.',
  ]) {
    const result = answerProcedure(prefix + detail);
    assert.equal(result.kind, 'missing', detail);
    assert.deepEqual(result.citations, [], detail);
    assert.match(result.email, /cho biết một năm niên phí/, detail);
    assert.doesNotMatch(result.email, /2\.200|6\.600/, detail);
  }
  const known = answerProcedure(prefix + 'Khách xác nhận nộp năm thứ 12.');
  assert.equal(known.kind, 'supported');
  assert.deepEqual(known.citations.map(row => row.id), ['th-fee-12']);
  const partial = answerProcedure(prefix + 'Năm thứ 8 hoặc năm thứ 12. Dùng biểu mẫu nào?');
  assert.equal(partial.kind, 'partial');
  assert.deepEqual(partial.citations.map(row => row.id), ['th-form']);
  assert.match(partial.body, /cho biết một năm niên phí/);
});

test('exact deadline queries name the case data required and use general rules as context', () => {
  for (const question of [
    'Gia hạn nhãn hiệu Việt Nam: khách chưa cung cấp ngày hết hiệu lực. Tính giúp ngày đến hạn cụ thể và cho biết dữ kiện nào còn thiếu.',
    'Gia hạn nhãn hiệu Việt Nam: chưa có ngày hết hiệu lực trên văn bằng. Về thời hạn, ngày nộp cụ thể tính thế nào?',
    'For Vietnam trademark renewal, what date should we file by?',
    'Gia hạn nhãn hiệu Việt Nam. Hạn chót là ngày nào?',
  ]) {
    const result = answerProcedure(question);
    assert.equal(result.kind, 'missing', question);
    assert.match(result.sections[0].missing, /ngày hết hiệu lực trên Giấy chứng nhận/, question);
    assert.ok(result.citations.length && result.citations.every(row => row.state === 'context'), question);
  }
  const thai = answerProcedure('Niên phí sáng chế Thái Lan, tính ngày đến hạn cụ thể cho tôi.');
  assert.equal(thai.kind, 'missing');
  assert.match(thai.sections[0].missing, /ngày nộp đơn.*ngày cấp bằng.*năm niên phí.*tình trạng thanh toán/);
  const general = answerProcedure('Gia hạn nhãn hiệu Việt Nam, thời hạn nộp thông thường là bao lâu?');
  assert.equal(general.kind, 'supported');
  assert.match(general.body, /6 tháng trước/);
});
