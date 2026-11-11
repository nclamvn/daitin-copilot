const prepare = (question, asOf) => ({ question, asOf, mode: 'prepare', anonymized: true });
const existing = (question, asOf, receivedOn, pendingAtCutover = null) =>
  ({ question, asOf, receivedOn, pendingAtCutover, mode: 'case', anonymized: true });
const lookup = (id, request, status, evidence, form = null) => ({ id, request, expected: { status, evidence, form } });
const responseQuestion = 'Căn cứ nào và dùng văn bản gì để phản hồi thông báo kết quả thẩm định nhãn hiệu Việt Nam?';
const renewal = 'Hồ sơ gia hạn hiệu lực văn bằng nhãn hiệu Việt Nam dùng biểu mẫu nào?';

export const questions = [
  lookup('Q01', prepare(renewal, '2026-04-01'), 'grounded', 'tt10-109-3a', 'renewal-tt10-02'),
  lookup('Q02', prepare('Nộp yêu cầu gia hạn nhãn hiệu thì lấy mẫu nào?', '2026-06-30'), 'grounded', 'tt10-109-3a', 'renewal-tt10-02'),
  lookup('Q03', prepare('Gia han van bang nhan hieu Viet Nam dung mau gi?', '2026-07-01'), 'grounded', 'tt20-11', 'renewal-tt20-01'),
  lookup('Q04', prepare(renewal, '2026-11-10'), 'grounded', 'tt20-16', 'renewal-tt20-01'),
  lookup('Q05', existing(renewal, '2026-07-01', '2026-06-26', true), 'grounded', 'tt20-17-2', 'renewal-tt10-02'),
  lookup('Q06', existing(renewal, '2026-09-11', '2026-06-29', false), 'historical', 'tt20-17-2', 'renewal-tt10-02'),
  lookup('Q07', existing(renewal, '2026-07-28', '2026-07-01'), 'grounded', 'tt20-11', 'renewal-tt20-01'),
  lookup('Q08', prepare('Điều 93 khoản 6 Luật Sở hữu trí tuệ quy định gì?', '2026-10-01'), 'reference', 'law-93-6'),
  lookup('Q09', prepare('Điều 83 khoản 2 điểm b Thông tư 10/2026/TT-BKHCN', '2026-09-14'), 'reference', 'tt10-83-2b'),
  lookup('Q10', prepare('Điều 83 khoản 2 điểm a Thông tư 10/2026/TT-BKHCN', '2026-09-14'), 'reference', 'tt10-83-2a'),
  lookup('Q11', prepare('Điều 108 khoản 3 06/VBHN-BKHCN nói gì?', '2026-09-14'), 'reference', 'vbhn06-108-3'),
  lookup('Q12', prepare('Điều 17 khoản 2 Thông tư 20/2026/TT-BKHCN', '2026-07-08'), 'reference', 'tt20-17-2')
];

export const safety = [
  lookup('S01', prepare(renewal, null), 'needs_context', null),
  lookup('S02', prepare(responseQuestion, '2026-09-14'), 'needs_context', null),
  lookup('S03', existing(renewal, '2026-09-11', '2026-06-29'), 'needs_context', 'tt20-17-2'),
  lookup('S04', prepare(renewal, '2026-11-11'), 'out_of_coverage', null),
  lookup('S05', prepare('Tính phí và hạn cuối cho yêu cầu gia hạn nhãn hiệu này', '2026-10-03'), 'needs_review', null),
  lookup('S06', prepare('Nộp đơn mới và gia hạn văn bằng cùng dùng mẫu nào?', '2026-09-14'), 'needs_review', null),
  lookup('S07', prepare('Đăng ký Madrid số IR 9999999 chỉ định Việt Nam và Thái Lan. Hai nơi đã được bảo hộ chưa?', '2026-09-14'), 'referral', null),
  lookup('S08', prepare('Điều 83 khoản 2 điểm z Thông tư 10/2026/TT-BKHCN', '2026-09-14'), 'not_found', null)
];

const examples = [
  ['Lam Hà', 'dụng cụ gia dụng', 'bình nước bằng thép', 'bình giữ nhiệt bằng thép', 'Bảng đối chiếu danh mục'],
  ['Sơn Hải', 'thiết bị âm thanh', 'loa di động', 'loa không dây', 'Bản mô tả sản phẩm'],
  ['Nếp Sáng', 'thực phẩm từ gạo', 'bánh gạo', 'bánh gạo nướng', 'Bảng mô tả hàng hóa'],
  ['Bình Minh Studio', 'ấn phẩm in', 'sổ tay', 'sổ ghi chép', 'Bảng danh mục sửa đổi'],
  ['Vườn Nâu', 'đồ uống từ cà phê', 'cà phê rang', 'cà phê hạt rang', 'Bản đối chiếu tên hàng hóa'],
  ['Mộc Trà', 'dụng cụ đựng trà', 'hộp đựng trà', 'hộp đựng trà bằng kim loại', 'Bản mô tả bao bì'],
  ['Hải Mộc', 'phụ kiện thiết bị điện tử', 'vỏ bảo vệ máy tính bảng', 'bao bảo vệ máy tính bảng', 'Bảng đối chiếu mô tả'],
  ['Thanh Vân', 'đồ dùng văn phòng', 'kẹp giấy', 'kẹp giấy bằng kim loại', 'Bảng tổng hợp tài liệu'],
  ['Viễn Quang', 'thiết bị chiếu sáng', 'đèn bàn', 'đèn bàn LED', 'Bản giải trình danh mục'],
  ['Tầm Mây', 'dụng cụ thể thao', 'bóng tập', 'bóng tập thể dục', 'Bảng đối chiếu thuật ngữ']
];

export const matters = examples.map(([title, old, first, next, attachment], index) => {
  const id = 'W' + String(index + 1).padStart(2, '0');
  const cross = index === 3 || index === 7;
  const asOf = index === 8 ? '2026-06-29' : '2026-10-' + String(index + 10);
  const receivedOn = cross || index === 8 ? '2026-06-10' : '2026-09-' + String(index + 11);
  const pendingAtCutover = cross ? true : null;
  const question = index % 2 ? 'Phản hồi thông báo thẩm định nhãn hiệu dùng mẫu nào?' : responseQuestion;
  return {
    id, title, first, next, attachment,
    request: existing(question, asOf, receivedOn, pendingAtCutover),
    expected: { status: 'grounded', evidence: 'tt10-83-2b', form: null },
    facts: { asOf, receivedOn, pendingAtCutover },
    notice: { label: 'Thông báo thẩm định', text: 'Cơ quan đề nghị làm rõ cụm "' + old + '" trong danh mục hàng hóa của đơn đăng ký.' },
    instructions: { label: 'Chỉ dẫn khách hàng', text: 'Khách hàng xác nhận làm rõ cụm "' + old + '" thành "' + first +
      '". Dự kiến kèm tài liệu "' + attachment + '".' },
    update: { label: 'Xác nhận mới', text: 'Khách hàng xác nhận dùng "' + next + '" thay cho "' + first + '". Các nội dung còn lại giữ nguyên.' },
    draft: 'Soạn bản phản hồi đầu tiên theo thông báo và chỉ dẫn đã chọn.',
    revise: 'Chỉ sửa phần phản hồi theo cụm hàng hóa khách hàng vừa xác nhận. Giữ nguyên phần yêu cầu làm rõ và tài liệu kèm theo.'
  };
});
