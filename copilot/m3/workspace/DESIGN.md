# Chuẩn thiết kế · Bàn hồ sơ Đại Tín

Concept Bàn hồ sơ sở hữu trí tuệ đã được chọn làm chuẩn giao diện sản phẩm. Bản tương tác gốc nằm tại `dai-tin-workspace-concept.html` trong thư mục outputs. Giao diện thực hiện đầu tiên nằm tại `/copilot/m3/workspace/`.

## Bố cục và trạng thái

- **Thanh hồ sơ bên trái** giữ mã, tên và điều hướng quay lại công việc. Mã đang mở luôn hiện ở đầu trang và trong ô giao việc.
- **Tài liệu ở giữa** có ưu tiên hiển thị. Khi chưa có tài liệu, ưu tiên tiếp nhận và giao việc. Khi đã có nháp, ưu tiên nội dung, phần thay đổi và quyết định duyệt. Ô giao việc giữ ở chân vùng giữa.
- **Ngăn đối chiếu bên phải** tách nguồn của hồ sơ, căn cứ theo SOT và phiên bản đã duyệt. Trên màn hình hẹp, hồ sơ và ngăn đối chiếu mở theo yêu cầu.
- **Be Vietnam Pro** dùng xuyên suốt. Thanh hồ sơ xanh than `#101f26`, nền bàn `#f0f3f1`, giấy trắng và xanh lục đậm `#174d42` cho hành động. Hổ phách biểu thị chờ duyệt. Nhãn chữ đi kèm mọi trạng thái và dấu so sánh.
- Hiển thị rõ tệp chưa lưu, nguồn đã lưu và nguồn được chọn cho lượt soạn. Văn bản nhập vào luôn gắn với vai trò và mã hồ sơ cụ thể.

## Quy tắc nghiệp vụ khi mở rộng

- Ô giao việc nhận lệnh text và nguồn. Phạm vi sửa phải hiển thị được trước khi gửi. Giọng nói sau này đi vào cùng ô qua bản chép lời có thể chỉnh.
- AI đề xuất thay đổi trên bản nháp. Luật sư quyết định từng phần. “Giữ bản cũ” tạo một nháp nối tiếp về nội dung đã duyệt và giữ đề xuất trước trong lịch sử.
- Bản xuất luôn lấy từ bản duyệt lưu trên máy chủ. Bản xem trước chỉ ra bản nháp nguồn của mỗi phần. Giao diện kiểm dấu SHA-256 trước khi lưu tệp tải.
- Giao diện dùng cùng mã hồ sơ, kho M3 và resolver SOT. Thử nghiệm mới dùng kho cô lập. Đo hiệu quả bằng thời gian thao tác, sai phiên bản và công tìm lại nguồn trên cùng tác vụ.
