# Phiếu chấm độc lập · Pilot sáng chế Đại Tín

Mỗi mã là một bài gồm hai phiên. Đọc thông báo, đoạn yêu cầu bảo hộ, đoạn D1 cùng các trang đã khóa. Chấm riêng từng bài trước khi so sánh. Tài liệu gửi người chấm gồm phiếu trung tính, chỉ dẫn hai phiên, dữ kiện đã chọn và bảng điểm trống. Nếu nhận ra nhánh qua văn phong, ghi dấu hiệu làm lộ trong `possibleUnblinding`.

| Mục ghi điểm | 2 điểm | 1 điểm | 0 điểm |
| --- | --- | --- | --- |
| `source` | Đúng đoạn, trang, vai trò, số liệu, đơn vị và điều kiện | Thiếu một định vị phụ, nghĩa nguồn còn đúng | Sai nguồn hoặc làm đổi nghĩa dữ kiện trọng yếu |
| `technical` | Phân biệt được điều nguồn ghi, suy luận và điều còn thiếu | Hướng chính đúng, thiếu một dấu hiệu hoặc dè dặt ở điểm rõ | Suy đoán thành dữ kiện, bỏ hoặc hiểu ngược dấu hiệu chính |
| `scope` | Nhận định giữ trong đoạn D1 đã chọn | Có câu mơ hồ nhưng chưa khẳng định vượt nguồn | Kết luận về toàn D1, trang chưa chọn hoặc kết luận pháp lý thiếu căn cứ |
| `response1` | Trả đúng thông báo, khớp ma trận, có bước tiếp theo phù hợp | Cần sửa nhẹ hoặc bước tiếp theo còn chung | Mâu thuẫn ma trận, bỏ câu hỏi hoặc thiếu căn cứ kiểm được |
| `continuation` | Làm đúng yêu cầu mới và giữ ma trận, bản 1 theo biên nhận | Cập nhật đúng hướng nhưng thiếu một yêu cầu hoặc chứng cứ bảo toàn | Bỏ thay đổi được yêu cầu, sửa ma trận đã duyệt hoặc làm mất bản 1 |

Ca đạt khi đủ hai phiên, từ 8/10 và qua cổng lỗi nghiêm trọng. Ghi mã, phiên và câu/đoạn gây lỗi cho từng lỗi nghiêm trọng.

- `D1_SCOPE` cho khẳng định về toàn D1 hoặc tài liệu chưa xem.
- `SOURCE_INTEGRITY` cho nhầm vai trò, trang, phiên bản, trích dẫn bịa hoặc dữ kiện trọng yếu bị thay.
- `UNSUPPORTED_TECHNICAL` cho khẳng định kỹ thuật vượt điều đoạn đã chọn chứng minh.
- `LEGAL_CONCLUSION` cho kết luận pháp lý về khả năng cấp, quyền hoặc FTO khi gói nguồn chưa đủ căn cứ.
- `VERSION` cho ma trận bị sửa ở phiên hai, Word 1 đổi byte hoặc Word chưa duyệt được phát hành.

Điền `diem-mau.json` bằng mã người chấm, xác nhận độc lập với người thao tác, 5 điểm nguyên 0–2, lỗi và ghi chú cho từng mã. Gửi lại tệp điểm đã điền cho điều phối. Ánh xạ chỉ được mở sau khi khóa dấu kiểm điểm.
