# Nghiệm thu luồng tài liệu sáng chế qua hai phiên

M7 dùng cùng nguyên tắc chấm mù của [bộ 30 yêu cầu M6](PROTOCOL.md). Gói PDF mô phỏng M7 kiểm cổng tài liệu, lưu và phát hành. Các đoạn được thiết kế để thấy được lỗi ngữ nghĩa dù trích dẫn khớp. Gói đã được dùng trong phát triển nên chỉ dùng để hiệu chuẩn cách chấm.

## Dữ kiện và kết quả kiểm

| Ca | Dữ kiện | Kết quả kỳ vọng | Tiêu chí đạt |
| --- | --- | --- | --- |
| 01 | Thông báo mô phỏng trang PDF 2, văn bản về mã vạch kép | Xem bản gốc, ghim đúng đoạn trang 2 vào thông báo | Tệp tải lại trùng SHA-256, đoạn trích trùng lớp chữ, trang hiển thị là trang vật lý 2 |
| 02 | Cùng PDF, gửi hash khác, sửa một chữ hoặc dùng bản hồ sơ cũ | Chặn thao tác trước khi lưu | Không đổi phiên bản, không thêm nguồn hoặc PDF |
| 03 | Claim mô phỏng trang 1 và D1 mô phỏng trang 1 | Gán đúng vai trò, dẫn lại đúng hai bản gốc trong ma trận | D1 mô tả mã vạch ở phần nhãn rời. Chưa đủ căn cứ cho dấu hiệu mã vạch kép trải qua cả hai phần. Dẫn đúng đoạn không tự xác nhận dấu hiệu |
| 04 | PDF có mật khẩu, tệp hỏng, PDF không có lớp chữ | Người dùng biết lý do và có thể chọn tệp khác | Tệp lỗi không gắn vào hồ sơ, không tạo dữ kiện OCR suy đoán |
| 05 | Đã có đề xuất AI, dùng editor hoặc bỏ bước xác nhận rà nguồn | Chưa duyệt được; chỉ reviewer xác nhận phần đã đọc | Không có Word khi mới duyệt ma trận; Word bản 1 khi đủ hai phần |
| 06 | Đăng xuất, đăng nhập lại, có chỉ dẫn mới yêu cầu sửa phản hồi | Còn đủ tài liệu và bản 1, duyệt ma trận giữ nguyên | Phản hồi cần rà lại; có Word bản 2 sau khi duyệt, bản 1 vẫn trùng SHA-256 |
| 07 | Tài khoản nhóm khác có đường dẫn PDF/PNG/Word | Không đọc được tài liệu hoặc nội dung hồ sơ | Hồ sơ và cả ba loại tệp không lộ khi dùng URL trực tiếp; dữ liệu riêng không có trong danh mục công khai |
| 08 | Triển khai lại cùng commit sau khi có hai bản Word | Đọc lại đúng hồ sơ và bản gốc | Hai Word M7 và cả ba PDF giữ SHA-256. Word M6 và nhãn hiệu giữ SHA-256 đối chiếu |

## So giá trị với agent có công cụ

Chọn ca mới có nguồn được phép dùng, ưu tiên khác nhóm kỹ thuật với mẫu mã vạch. Khóa trước dữ kiện, nguồn/hash, thời điểm pháp lý, prompt hệ thống, model và công cụ, ngân sách và thang chấm. Cùng người thực hiện hoặc hoán đổi thứ tự hai nhánh để giảm hiệu ứng học. Agent được cung cấp bộ đọc PDF, file workspace và thư viện xuất Word như năng lực thực có. Ghi rõ mọi khác biệt cấu hình.

Phiên đầu kết thúc khi có đầu ra đủ điều kiện để chấm. Phiên sau mở một phiên làm việc mới và nhận một thay đổi chưa thấy trước. Cả hai nhánh phải mở lại được căn cứ, cập nhật đúng phần và giữ đúng bản xuất đã duyệt trước đó. Tách thời gian tìm/chọn nguồn, kiểm chứng, sửa, duyệt và xuất khỏi thời gian chờ máy. Lưu lần làm không đạt và lần sửa, tránh chỉ đo đầu ra đẹp nhất.

Người chấm chỉ nhận tài liệu bỏ nhãn nhánh và nguồn gốc từng đoạn. Mỗi hàng ma trận chấm đủ ba điểm: dấu hiệu mô tả đúng claim, D1 có hỗ trợ đúng phạm vi nhận định, thiếu dữ kiện được diễn đạt đúng. Các lỗi nghiêm trọng gồm dùng nhầm trang hoặc phiên bản, gán nhầm vai trò, viện dẫn đoạn không hỗ trợ kết luận, phát hành chưa duyệt và lộ dữ liệu khác nhóm. Kiểm chữ và hash do code, nhận định chuyên môn do luật sư.

Đối chiếu một lần gọi model với cùng prompt chỉ đo hành vi sinh nội dung và thời gian máy. Công thao tác qua hai phiên, lợi thế so với agent có công cụ và chất lượng pháp lý phải có người thật thực hiện hoặc chấm. Mục tiêu 25% ít công thao tác hơn trong phân khúc cập nhật hồ sơ là giả thuyết từ M6, giữ cùng sàn chất lượng và đo trên cả hai phiên.
