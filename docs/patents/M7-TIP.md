# M7 · Từ PDF hồ sơ sáng chế đến bản Word đã duyệt

Ngày 11/11/2026. Phạm vi pilot trên web của Đại Tín. Tài liệu thử do nhóm triển khai tạo, các tài liệu công bố đã lưu giữ nguyên provenance. Dữ liệu M6 vẫn là nguồn ứng viên. Thẩm định pháp lý do luật sư thực hiện.

## Kết quả sử dụng

Anh Bình có thể mở hồ sơ, lưu PDF mô phỏng, tìm đúng trang, đối chiếu đoạn trích, gán vai trò cho chứng cứ và tiếp tục từ đúng tài liệu đã lưu. Phân tích kỹ thuật và phản hồi được sửa, duyệt riêng. Bản Word phát hành phải tải lại được đúng byte, kể cả sau đăng nhập lại, chỉnh sửa và triển khai lại.

M6 đã đo một lỗi ngữ nghĩa có thật: model dẫn đúng đoạn D1 nhưng đánh dấu một đặc điểm là đã được mô tả trong khi phản hồi yêu cầu xác minh đặc điểm ấy. M7 phải làm lộ phần nhận định chưa kiểm và giữ hành động xác nhận của người rà soát. Cổng kỹ thuật kiểm chứng cứ và trạng thái, không suy đoán chất lượng pháp lý.

## Thiết kế và ưu tiên

| Ưu tiên | Thành phần | Hợp đồng |
| --- | --- | --- |
| P0 | Tiếp nhận PDF | Tối đa 2 MiB mỗi tệp trong pilot. Dùng engine PDF hiện có, giới hạn số trang và đoạn. Lưu bản gốc/hash riêng tư, tách bản trích có vị trí. Chọn đoạn từ lớp chữ sau khi xem nguồn. Bản scan thiếu chữ, tệp khóa, tệp hỏng, quá kích thước hoặc sai đoạn phải trả lỗi có hướng xử lý. |
| P0 | Hồ sơ và chứng cứ | Ghim claim/D1/thông báo theo vai trò đã xác nhận, giữ các cách nhập văn bản và nguồn công bố M6. Không suy ra họ, tình trạng quyền hoặc tính mới. Cách ly theo nhóm, kiểm phiên bản khi lưu, kiểm định danh/hash/trang. Không đưa tệp riêng vào global catalog, CDN hoặc gửi PDF nhị phân cho model. |
| P0 | Rà soát | AI đề xuất, nêu giới hạn và để các nhận định ở trạng thái cần rà. Hành động của reviewer phân biệt với việc sửa văn bản của editor. Cập nhật đúng phần liên quan. Phản hồi do AI đề xuất ghi dấu kiểm nội dung ma trận làm căn cứ. Khi ma trận đổi, phản hồi cần rà và lưu lại trước khi duyệt. Đề xuất mới không tự thành bản duyệt. |
| P0 | Bản đã duyệt | Lưu chính bytes Word đã duyệt kèm hash theo số bản. Lưu cùng thay đổi trạng thái. Giữ đường render M6 để tải lại Word 1/2 đúng SHA. Dùng nhận diện Đại Tín và dàn khối đủ rộng cho trích dẫn dài. |
| P0 | Nghiệm thu | Dùng HTTP và trình duyệt thật. Kiểm một vòng có PDF, hai phiên, hai bản Word, quyền nhóm, input lỗi và kiểm đọc lại sau triển khai. Duy trì kiểm tra nhãn hiệu. |
| P1 | Độ trễ | Đo riêng đọc, thao tác lưu và AI. Ưu tiên bỏ tải/ghi không cần thiết nếu chứng minh được đường đọc không ghi kho. Giữ CAS và giới hạn tài nguyên. Ba đường đọc dùng POST gồm tra cứu, kiểm lớp chữ và xem ảnh trang đọc snapshot đã xác thực, không xin lease ghi. |

Phân vai: backend triển khai tiếp nhận, hồ sơ, cổng rà soát, lưu; frontend thực hiện luồng tiếp nhận và duyệt; Word triển khai bộ xuất mới và render kiểm; Contractor kiểm độc lập, ghi biên bản, tích hợp Git và triển khai. Giới hạn snapshot Vercel hiện tại 16 MiB JSON; tổng byte PDF và Word mới cần trần cứng để tránh lấp hết kho. M7 không tạo tệp bản sao dự án, cài hệ phụ thuộc hoặc đổi nhà cung cấp.

## Cách kiểm chứng

- Hồ sơ mới dùng fixture PDF do nhóm tạo. Đổi trang hoặc một ký tự trong đoạn trích phải bị từ chối. SHA PDF tải lại đúng với tệp đưa vào và có mặt trong hồ sơ/bản duyệt. Mở bằng nhóm khác trả 404, phiên hết hiệu lực trả 401. Đoạn hỏng, trang rỗng và dữ liệu quá giới hạn bị chặn trước khi thay hồ sơ.
- AI dùng model dự án hiện có, không nâng trần 1 USD. Tối đa bốn lời gọi thật trong nghiệm thu M7. Hai phiên chỉ sinh lại phần cần sửa. Đối chứng đơn giản dùng cùng prompt/model/nguồn nếu có đủ bằng chứng và ngân sách. Dừng nếu provider lỗi hoặc không còn ca có ích. Ghi thời gian máy, hash và token, tách thời gian thao tác của người dùng.
- Giữ tập đánh giá độc lập về ngữ nghĩa cho luật sư. Kết quả QA thực thi bởi script, việc rà soát theo kịch bản và việc người hành nghề chấm chất lượng được ghi riêng. Không cộng số kiểm thử thành mức tiết kiệm công hoặc độ chính xác pháp lý.
- Chạy toàn bộ test/build sau tích hợp. So byte Word M6 và nhãn hiệu trước/sau, kiểm nguồn không thay đổi, mở hồ sơ qua hai phiên, thực hiện lần đọc lại sau triển khai lại, và render Word mới để xem toàn bộ trang. Nếu lỗi P0 thì sửa hoặc giữ bản deploy đang ổn.

## Điều kiện đóng mốc

Khi các cổng kỹ thuật đạt, công bố mốc pilot. Cổng sử dụng với khách hàng và phép thử giá trị vẫn phụ thuộc luật sư xác nhận nguồn, dữ kiện, kết quả và đo công thao tác trên bộ yêu cầu độc lập. Các giới hạn OCR, độ bao phủ nguồn và chi phí snapshot phải được ghi tại bàn giao.
