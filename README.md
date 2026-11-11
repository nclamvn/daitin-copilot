# DAITIN Copilot

Bàn hồ sơ sáng chế và nhãn hiệu cho pilot Đại Tín: tra căn cứ theo thời điểm, làm việc từ nguồn được chọn, sửa và duyệt từng phần, lưu phiên bản và xuất đúng Word đã duyệt. Giao diện dùng logo chính thức và font Be Vietnam Pro.

## Hồ sơ sáng chế M7

Mở `/patents/`, tạo hoặc mở hồ sơ mô phỏng, rồi vào **Tài liệu** để chọn PDF. Đọc tối đa bốn trang mỗi lượt, mở hình trang gốc, chọn đúng đoạn từ lớp chữ và xác nhận vai trò thông báo, yêu cầu bảo hộ hoặc D1. Pilot hỗ trợ PDF có lớp chữ, tối đa 2 MiB và 12 trang mỗi tệp. PDF thiếu lớp chữ vẫn có thể xem trang nếu tệp đọc được. Luật sư có thể nhập văn bản hoặc TXT/MD theo luồng hiện có.

Dùng các đoạn đã ghim để lập ma trận và phản hồi. Phần AI đề xuất cần reviewer xác nhận đã rà soát trước khi duyệt. Có thể duyệt hai phần riêng. Khi cả hai phần đã duyệt, hệ thống lưu bản Word với SHA-256 và tải lại đúng tệp đó theo số phiên bản. Thay chỉ dẫn chỉ yêu cầu duyệt lại phản hồi. PDF và đoạn trích riêng được lưu trong phạm vi hồ sơ và nhóm.

Chi tiết triển khai và các ca kiểm trong [TIP M7](docs/patents/M7-TIP.md) và [quy trình nghiệm thu hai phiên](docs/patents/acceptance/M7-PROTOCOL.md).

Kho dữ liệu được cào có giới hạn từ nguồn công khai được phép, kết hợp văn bản đã lưu; có bản gốc, dấu kiểm, đoạn trích, quan hệ phụ thuộc được trích xuất và các khoảng trống khai báo. Văn bản OCR cần kiểm lại bản gốc; đoạn đã biết lỗi bị chặn khi phân tích hoặc duyệt. Không có bộ tình trạng quyền/họ sáng chế đã xác minh, tra cứu tình trạng kỹ thuật đầy đủ hay kết luận tính mới/FTO tự động. SOT vẫn là ứng viên chờ luật sư rà soát. Chi tiết: [TIP M6](docs/patents/M6-TIP.md), [bộ 30 yêu cầu và cách chấm](docs/patents/acceptance/PROTOCOL.md).

## Nhãn hiệu: phạm vi pilot được giữ

- Tám hồ sơ hoàn toàn mô phỏng; không có hồ sơ khách hàng thật hoặc khóa truy cập trong mã nguồn.
- Tuyến quốc gia Việt Nam, kho SOT ứng viên kiểm chứng từ 01/04 đến 10/11/2026. Luật sư chưa duyệt để sử dụng cho hồ sơ thật.
- Tra cứu, đối chiếu mốc chuyển tiếp, mở đúng trang PDF và phiên bản biểu mẫu. Madrid chuyển sang nguồn WIPO để xác minh riêng.
- Nhập PDF/TXT/MD hoặc dán nguồn; sửa bằng AI hay bằng tay, chọn nguồn cho phần sửa, duyệt bằng vai trò luật sư; Word cũ giữ nguyên khi tạo bản mới.
- Không tự tính hạn/phí, kết luận khả năng đăng ký, nộp hồ sơ hay gửi văn bản ra ngoài.

## Chạy và kiểm tra

Cần Node.js 24. Cài đúng dependency bằng `npm ci`; chạy `npm test` và `npm run check`. Các kiểm tra SOT gốc còn dùng Python và công cụ đọc PDF của môi trường phát triển. Không dùng kết quả kiểm cấu trúc thay cho luật sư rà soát nội dung.

`npm start` chạy gói máy chủ riêng sau khi cấu hình HTTPS, dữ liệu và AI. Hướng dẫn [máy chủ riêng](deploy/README-WEB.md), [chuyển lên Vercel](docs/VERCEL-PILOT.md), [nguồn SOT](sot/README.md). Lịch sử các mốc cục bộ được giữ ở [local milestones](docs/history/local-milestones.md).

## Vercel

Ứng dụng dùng một Node Function cùng private Vercel Blob. Mỗi yêu cầu mở bản SQLite làm việc tạm, dùng lại nghiệp vụ chung, rồi lưu trạng thái bằng điều kiện ETag trước khi xác nhận thành công. Session chỉ lưu dấu băm token; tài khoản và hạn mức nằm trong snapshot riêng để có hiệu lực qua các instance. Lease chặn hai thao tác ghi đồng thời. Thư mục tạm không phải kho bền vững.

Kho nguồn bất biến được xác minh một lần mỗi instance, tránh đọc/băm lại toàn bộ tài liệu cho từng thao tác. PDF.js xử lý PDF trên web; Poppler được giữ cho nhánh cục bộ. Vercel giới hạn PDF 2 MiB/12 trang. Word giữ nhận diện đã chốt và trình bày chứng cứ thành các khối dễ đọc. Bản phát hành M7 lưu tệp Word vào kho cùng hồ sơ. Các bản cũ dùng bộ xuất tương ứng với lúc phát hành.

AI trên bản Vercel đi qua AI Gateway với danh tính máy chủ, không gửi khóa vào trình duyệt. Model cụ thể, hạn mức và phép kiểm thực tế được ghi trong biên bản bàn giao. Không có tự động mua credits, đổi model khi lỗi hoặc lặp lời gọi model sau lỗi lưu. Đổi model không giữ nguyên kết luận của phép đo Qwen cục bộ trước đây.

## Vận hành và giới hạn

Đây là kiến trúc pilot nhỏ: snapshot tối đa 16 MiB và thao tác ghi nối tiếp, không phải thiết kế cho nhiều khách hàng hoặc tải lớn. Khi tăng dữ liệu/concurrency, chuyển kho mutable sang database giao dịch trước khi mở rộng. Nguồn snapshot và tệp có dấu kiểm; quyền quản trị máy chủ vẫn có thể sửa kho, không coi đây là kho chứng cứ chống sửa bởi quản trị viên.

Không có SSO/MFA, phân quyền theo khách hàng hay nghiệm thu bảo mật/pháp lý độc lập. Chỉ dùng dữ liệu mô phỏng hoặc đã ẩn danh và được phép trong pilot. Chưa đo công thao tác luật sư thật so với agent trực tiếp; số kiểm tra kỹ thuật không chứng minh lợi thế năng suất.

Mã nguồn giữ riêng tư. Các tệp `.env*` (trừ ví dụ), `.vercel`, khóa, nhật ký và dữ liệu làm việc phải nằm ngoài Git. Không đưa các khóa trên máy tác giả vào bản cloud. Không triển khai lên Base44.
