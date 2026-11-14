import { emailCases } from './cases.mjs';
import { planEmail } from './plan.mjs';
import { suggestMail } from '../ui/email.mjs';

export function mailFromSections(sections, topic, pending) {
  const parts = sections.filter(section => section.pending === pending && section.text.trim());
  if (!parts.length) return '';
  return 'Chào anh/chị,\n\nVề việc ' + topic.toLowerCase() + ',\n\n' +
    parts.map(section => (section.title ?? section.id) + '\n' + section.text.trim()).join('\n\n') + '\n\nTrân trọng,';
}

const clean = text => (text ?? '').normalize('NFC').toLocaleLowerCase('vi').replace(/\s+/g, ' ');
const markers = {
  'vn-form-01': /mẫu\s*(số\s*)?0?1/,
  'vn-paper': /bản gốc/,
  'vn-poa': /đại diện/,
  'vn-poa-reuse': /bản sao/,
  'vn-window': /6 tháng trước/,
  'vn-late': /(?:muộn|sau).{0,65}6 tháng|6 tháng.{0,65}(?:muộn|sau|kể từ)/,
  'vn-base-fees': /160[., ]?000.*120[., ]?000/,
  'vn-use-fee': /700[., ]?000/,
  'vn-renew-fee-2026': /50[., ]?000/,
  'vn-late-fee-base': /10\s*%/,
  'vn-reduction': /50\s*%/,
  'th-form': /010/,
  'th-window': /60 ngày/,
  'th-grant': /ngày cấp/,
  'th-late': /120 ngày/,
  'th-prepay': /trả|thanh toán|nộp/,
  'th-fee-prepay': /140[., ]?000/,
  'th-fee-5': /1[., ]?000/,
  'th-fee-6': /1[., ]?200/,
  'th-fee-8': /2[., ]?200/,
  'th-fee-10': /4[., ]?000/,
  'th-fee-12': /6[., ]?600/,
};
export function gradeSubmission(row) {
  const fixture = emailCases.find(item => item.id === row.case);
  const first = suggestMail(fixture.first);
  const input = row.session === 1 ? first : suggestMail(fixture.next, first);
  const plan = planEmail(input);
  const check = (expected, output) => {
    if (!output || expected.pending !== output.pending) return false;
    const text = clean(output.text);
    if (expected.pending) return /xác nhận|cho biết|đối chiếu|chưa đủ|cần kiểm/.test(text) &&
      !(expected.id === 'poa' && /bắt buộc|được dùng lại|không cần poa|phải có poa/.test(text)) &&
      !(expected.id === 'fee' && /\d[.,]\d{3}\s*thb/.test(text));
    if (expected.sources.some(source => markers[source.id] && !markers[source.id].test(text))) return false;
    if (expected.id === 'poa' && input.poa === 'reuse' && !/bản gốc|số đơn/.test(text)) return false;
    if (expected.id === 'late-fee' && fixture.topic === 'th-annuity' &&
        (!/30\s*%/.test(text) || /muộn hơn 120 ngày|quá 120 ngày.*30\s*%/.test(text))) return false;
    return expected.id !== 'fee' || fixture.topic !== 'vn-renewal' || /2026/.test(text);
  };
  const issues = plan.sections.flatMap(section => {
    const item = row.sections.find(candidate => candidate.id === section.id);
    if (!item) return [{ id: section.id, reason: 'Thiếu mục đã giao.' }];
    const allowed = section.sources.map(source => source.id);
    const badCitations = item.ids.some(id => !allowed.includes(id)) || (!section.pending && allowed.some(id => !item.ids.includes(id)));
    if (check(section, item) && !badCitations) return [];
    return [{ id: section.id, reason: 'Đối chiếu lại dữ kiện và điều kiện áp dụng. ' +
      (section.pending ? 'Mục này cần trả về dạng câu hỏi xác nhận. ' : 'Giữ mọi điều kiện trong các đoạn bắt buộc. ') +
      'Mã đoạn cần đối chiếu ' + (allowed.join(', ') || 'chưa có đoạn kết luận') + '.' }];
  });
  const coverage = row.sections.length === plan.sections.length &&
    plan.sections.every(section => row.sections.some(item => item.id === section.id));
  const facts = coverage && plan.sections.every(section => check(section, row.sections.find(item => item.id === section.id)));
  const citations = coverage && row.sections.every(item => {
    const expected = plan.sections.find(section => section.id === item.id);
    const allowed = expected.sources.map(source => source.id);
    return item.ids.every(id => allowed.includes(id)) && (expected.pending || allowed.every(id => item.ids.includes(id)));
  });
  const draft = coverage && Boolean(row.client) === plan.sections.some(item => !item.pending) &&
    Boolean(row.partner) === plan.sections.some(item => item.pending) &&
    row.sections.every(item => clean(item.text).trim() &&
      clean(item.pending ? row.partner : row.client).includes(clean(item.text).trim()));
  return { code: row.code, case: row.case, session: row.session, coverage, facts, citations, draft,
    issues, pass: coverage && facts && citations && draft };
}
