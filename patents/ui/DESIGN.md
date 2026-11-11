# Bàn hồ sơ sáng chế Đại Tín

Giữ hệ nhận diện đã duyệt: logo thật trên nền trắng, Be Vietnam Pro cho toàn bộ giao diện. Nền điều hướng `#101f26`, giấy `#ffffff`, vùng làm việc `#f0f3f1`, chữ `#182b2e`, nhấn hành động `#174d42`, chữ phụ `#526664`. Trạng thái chưa duyệt dùng màu hổ phách tiết chế; màu luôn đi cùng nhãn chữ.

Trục thị giác chính là ma trận yêu cầu bảo hộ và đối chứng D1. Mỗi nhận định đứng cạnh nguồn và vị trí cụ thể, không đặt điểm khả năng được cấp bằng. Bản phản hồi và phiên bản đã duyệt là đầu ra bền vững của hồ sơ; kết quả tìm kiếm là nguồn để chọn vào công việc.

```text
┌ Điều hướng Đại Tín ┬ Hồ sơ / trạng thái lưu / bản duyệt ┬ Nguồn đã chọn ┐
│ Nhãn hiệu         │ Tra cứu | Ma trận | Phản hồi       │ Vai trò nguồn │
│ Sáng chế          │ Nội dung đang làm                  │ Điều / claim  │
│ Hồ sơ đã lưu      │                                    │ Trang gốc     │
│                   │ Giao việc theo nguồn và phạm vi    │ Ngày / lỗ hổng│
└───────────────────┴────────────────────────────────────┴───────────────┘
```

Tất cả cột căn trái. Thanh hồ sơ 222–238 px, nội dung linh hoạt, ngăn nguồn 300–330 px. Danh sách hồ sơ cuộn riêng để logo và vùng điều hướng luôn còn trên màn hình. Màn hình hẹp dùng nút mở hồ sơ và nguồn, không ép bảng lớn ra ngoài màn hình; các hàng ma trận trở thành khối có nhãn cột rõ ràng.

Không mở đầu bằng thống kê hoặc thẻ giới thiệu. Trạng thái rỗng dẫn thẳng đến tìm nguồn và tạo hồ sơ. Kho ứng viên, dữ kiện chưa có ngày áp dụng, suy luận mô hình và quyết định duyệt của luật sư có nhãn riêng. Không dùng HTML do model tạo. Không tự gán hiệu lực, ngày ưu tiên, family hoặc tình trạng văn bằng khi chưa có chứng cứ.

Bản triển khai mở ngay thư mục nguồn công khai và hồ sơ đối chiếu mẫu một lần bấm. Thông báo/chỉ dẫn được nhập tay hoặc chọn TXT/MD và lưu riêng theo nhóm; không trộn vào corpus. Sau khi mở hồ sơ, dữ kiện dài nằm trong các vùng thu gọn, ma trận là bề mặt chính. Chỉ bản ghi claim thật mới được gán làm yêu cầu đang xét. D1 không được trùng nguồn hoặc cùng mã công bố đã biết với target; không suy ra quan hệ họ sáng chế khi chưa biết. Lớp chữ OCR chưa rà soát có nhãn đối chiếu bản gốc; bản trích có lỗi đã biết chặn AI/duyệt.

Nguồn có hai đường mở rõ ràng: bản thu thập cố định theo SHA tại dịch vụ và bản trực tuyến của cơ quan nguồn. Trích đoạn được hiển thị như văn bản thuần. Bản xem trước của danh mục được ghi là rút gọn và phải mở chứng cứ để đọc nguyên văn. Biên tập phần này không được tự xóa phần đang sửa dở ở phần khác.

Rà soát thiết kế trước thi công: giữ bảng màu và bố cục sản phẩm hiện hữu là yêu cầu xuyên suốt, không thay bằng concept khác. Điểm đặc thù dành cho sáng chế là yêu cầu bảo hộ, đối chứng, trích đoạn và sự tách biệt giữa suy luận và nguồn. Đánh số chỉ dành cho yêu cầu bảo hộ/phần nội dung có thứ tự thật; không thêm nhãn hoặc khối trang trí để tạo cảm giác công nghệ.

## M7. PDF vào hồ sơ, quyết định trong hồ sơ

Tài liệu riêng có mục làm việc riêng giữa thư mục công khai và ma trận. Hồ sơ mới có thể lưu mã, tên và ngày đối chiếu trước, rồi nhập PDF hoặc dữ kiện bằng tay. Tên và ngày nằm trên đầu hồ sơ. Cạnh đó là việc cần làm tiếp theo dựa trên dữ liệu đã lưu. Cách bố trí này giữ hồ sơ và nguồn luôn thấy được ở hai cột bên, để phần chính ưu tiên tài liệu, ma trận hoặc bản phản hồi theo tác vụ.

Khi đọc PDF, người dùng chọn phạm vi trang, mở ảnh của đúng trang, chọn văn bản nguyên văn rồi xác nhận vị trí và vai trò trước khi gắn. Tệp, ảnh trang và dấu kiểm đi cùng hồ sơ theo quyền truy cập của nhóm. Trên điện thoại, ảnh trang cuộn riêng và nội dung trích nằm ngay sau ảnh. Dòng thông báo chỉ nơi cần sửa nếu tệp quá lớn, không có lớp chữ hoặc hồ sơ đã đổi ở phiên khác.

Bảng ma trận dùng giấy sáng cho nguyên văn. Khối hổ phách dưới phần đề xuất yêu cầu luật sư rà soát nội dung trước khi duyệt. Xác nhận trích PDF và duyệt nhận định là hai hành động riêng. Lịch sử ghi các bản Word đã duyệt, có dấu kiểm tệp cho bản được lưu thành phẩm. Mở hồ sơ theo đường dẫn giữ mục đã chọn và tải dữ liệu hồ sơ trước khi cần danh mục công khai.

Mục Hồ sơ sáng chế mới mở bộ ba tài liệu theo vai trò ngay trong hộp thoại. Chọn cả ba tệp hoặc chọn riêng từng vai trò. Dòng tệp cho thấy tên, khoảng trang và thao tác đổi vị trí. Màn đối chiếu chỉ mở một tài liệu mỗi lần để dành chiều rộng cho ảnh trang và đoạn nguyên văn. Trạng thái của từng vai trò cho biết phần nào còn chờ xác nhận. Khi quay lại chỉnh khoảng trang của một tài liệu, xác nhận của các tài liệu khác được giữ nếu bản đọc mới khớp dấu kiểm, trang và nguyên văn đã chọn. Nút lưu ghi đồng thời mã hồ sơ, chỉ dẫn và cả ba chứng cứ. Có thể chuyển sang hồ sơ trống hoặc nhập tay và giữ lại dữ kiện đã nhập.
