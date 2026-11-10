export const matter = {
  anonymized: true, reference: 'DT-M3-026', title: 'MỘC VÂN LAB', receivedOn: '2026-09-14', asOf: '2026-11-09',
  notice: { label: 'thong-bao.txt', text: 'Hồ sơ mô phỏng DT-M3-026, nhãn hiệu MỘC VÂN LAB. Thông báo yêu cầu làm rõ cụm “thiết bị đo” trong danh mục hàng hóa của đơn. Đề nghị giải thích phạm vi hàng hóa dự kiến.' },
  instructions: { label: 'chi-dan.txt', text: 'Khách hàng xác nhận đề nghị làm rõ cụm “thiết bị đo” thành “nhiệt kế điện tử dùng trong phòng thí nghiệm”. Bảng đối chiếu danh mục đã có sẵn, dự kiến kèm văn bản. Các nội dung khác giữ nguyên.' }
};
export const additional = {
  label: 'xac-nhan-moi.txt',
  text: 'Khách hàng xác nhận thay cụm dự kiến thành “nhiệt kế hồng ngoại dùng trong phòng thí nghiệm”. Giữ bảng đối chiếu danh mục. Có thể bổ sung bản sao thông báo vào danh sách tài liệu nếu luật sư duyệt mục này.'
};
export const revision = {
  instruction: 'Cập nhật nội dung phản hồi theo cụm hàng hóa khách hàng xác nhận mới nhất. Đề xuất thêm bản sao thông báo trong phần tài liệu kèm theo, ghi rõ dự kiến.',
  targets: ['response', 'attachments'],
  sources: ['notice', 'instructions', 'update-1']
};
export const manual = 'Đề nghị ghi nhận nội dung làm rõ nêu trên.';
