# Đại Tín Copilot: gói web tự triển khai

Ngày chuẩn bị: 11/11/2026, múi giờ Việt Nam. Chưa đưa mã nguồn, bộ SOT hoặc hồ sơ mẫu lên Base44. Chưa tạo đường dẫn Internet, tên miền hay dịch vụ trả phí. Gói dùng thử này dành cho dữ liệu mô phỏng hoặc đã ẩn danh và được phép; kho SOT vẫn là ứng viên chờ luật sư Đại Tín duyệt.

## Người nhận sử dụng

Khi được kỹ thuật đặt lên máy chủ, người nhận mở URL HTTPS được cấp bằng trình duyệt trên Windows, Mac hoặc thiết bị di động. Không cần cài ứng dụng, Node.js hay mô hình lên máy người nhận; máy chủ cần hoạt động. Mở `XEM-TRUOC.html` để xem ngay kịch bản hai phiên và tải Word mẫu khi chưa có máy chủ. Bản xem trước dùng đầu ra đã tạo sẵn, không gọi AI và không lưu hồ sơ lên máy chủ.

## Phạm vi có trong gói

- Logo thật Đại Tín, font Be Vietnam Pro, bàn làm việc, nguồn, bản nháp và lịch sử phiên bản.
- Tám hồ sơ mô phỏng. Hồ sơ 01 và 08 có bản duyệt đầu tiên được tạo/duyệt mô phỏng. Các hồ sơ còn lại có nguồn để thử soạn mới khi cấu hình AI.
- Tra pháp luật, đối chiếu thời điểm, mở đúng trang căn cứ và phiên bản biểu mẫu trong corpus quốc gia Việt Nam. Kho kiểm chứng từ 01/04 đến 10/11/2026; không tự khẳng định đã cập nhật ngày sau đó.
- Nhập PDF tối đa 4 MiB, tối đa 12 trang; trích văn bản và xác nhận dữ kiện. Không có OCR cho ảnh quét không có lớp văn bản; có thể nhập đoạn trích thủ công và phải xác nhận.
- Soạn/sửa bằng AI khi quản trị viên bật cấu hình máy chủ. Sửa tay, duyệt từng phần, lưu bền vững và xuất Word từ đúng bản duyệt. Word dùng mẫu Đại Tín đơn sắc đã chốt.
- Phân quyền chuyên viên/luật sư và tách nhóm hồ sơ. Người cùng nhóm dùng chung hồ sơ có chủ đích. Đây không phải mô hình mỗi người sở hữu hồ sơ riêng hoặc phân quyền theo khách hàng.

## Chạy trên máy chủ bằng Docker

Cần Docker Engine và Docker Compose v2; tối thiểu khuyến nghị 2 vCPU, 2 GB RAM và 10 GB đĩa trống cho máy chủ ứng dụng. Mô hình tự chạy cần tài nguyên riêng. Không tải mô hình cục bộ theo bản Mac khi dùng cấu hình web này.

1. Giải nén toàn bộ gói vào thư mục riêng. Kiểm dung lượng trước khi build. Dùng `node distribution/check.mjs .` nếu đã có Node 24 để kiểm danh mục SHA-256, hoặc dùng công cụ SHA-256 của hệ điều hành để kiểm ZIP trước.
2. Sao chép `.env.example` thành `.env`; đặt `DAITIN_DOMAIN` thành tên miền do đơn vị vận hành chọn và đã trỏ DNS tới máy chủ. Đây là thao tác cần người phụ trách hạ tầng thực hiện, chưa làm trong lần chuẩn bị này.
3. Chạy `docker compose -f compose.web.yaml config --quiet` để kiểm cấu hình, sau đó `docker compose -f compose.web.yaml up -d --build`.
4. Caddy nhận cổng 80/443 và cấp HTTPS khi DNS/mạng phù hợp. Cổng ứng dụng 4320 chỉ có trong mạng nội bộ Docker; không đưa trực tiếp ra Internet. Máy chủ giữ nguyên Host của tên miền đã cấu hình. Không tin các header Forwarded để cấp quyền.
5. Xem `docker compose -f compose.web.yaml logs --tail=50 app`. Tài khoản ngẫu nhiên được tạo ở volume dữ liệu, không có trong ZIP. Người quản trị đọc bằng `docker compose -f compose.web.yaml exec app cat /data/THONG-TIN-DANG-NHAP.txt` trong phiên riêng, rồi cấp đúng vai trò cho người thử qua kênh riêng. Không gửi tệp này kèm bộ demo công khai.
6. Mở URL HTTPS, đăng nhập, chọn hồ sơ Mộc Vân Lab. Nhóm `nhan-hieu` gồm tài khoản `luat-su` (duyệt) và `chuyen-vien` (sửa). Chỉ vai trò luật sư mới duyệt. Mỗi môi trường sinh khóa riêng; không tái dùng khóa trên máy tác giả.

Ứng dụng chạy một tiến trình, một bản sao; SQLite dùng volume `daitin_data`. Không scale nhiều replica với volume riêng. Session ở RAM, hết hạn sau hai giờ; khi khởi động lại dịch vụ phải đăng nhập lại. Hồ sơ, nguồn, bản duyệt và Word lưu trong SQLite vẫn còn. Chạy `docker compose -f compose.web.yaml stop` để dừng, `up -d` để mở lại. Không dùng `down -v` cho môi trường có dữ liệu cần giữ.

Ảnh Docker ứng dụng dùng nhãn tái sử dụng `daitin-web-mvp:latest`. Nền là Node 24 Debian và Poppler; Caddy nhánh 2. Gói chưa ghim toàn bộ digest/phụ thuộc hệ điều hành; khi chốt hạ tầng, khóa ảnh đã kiểm theo digest và có lịch cập nhật bảo mật riêng. Máy nhận ARM64 hoặc AMD64 tự build theo kiến trúc của máy chủ; lần chuẩn bị này kiểm Linux ARM64, chưa chạy máy chủ AMD64.

## AI mặc định chưa bật

Mặc định `DAI_TIN_MODEL_MODE=disabled` nên không có cuộc gọi AI ra ngoài. Giao diện hiển thị tình trạng này; API soạn trả 503 rõ lý do, giữ bản đã lưu. Vẫn tra luật, mở nguồn, sửa bản mẫu bằng tay và tải bản đã duyệt được. Không tự thay bằng câu trả lời giả lập.

Sau khi chọn và cho phép nhà cung cấp AI, kỹ thuật có thể cấu hình dịch vụ HTTPS tương thích chat completions:

```dotenv
DAI_TIN_MODEL_MODE=enabled
DAI_TIN_MODEL_ENDPOINT=https://model.example.com/v1/chat/completions
DAI_TIN_MODEL_ID=provider-model-id
```

Đây là giá trị ví dụ, không phải dịch vụ đang hoạt động. Khóa đặt riêng tại `/data/model.key`, quyền 0600, thuộc tài khoản ứng dụng. Không đặt khóa trong `.env`, mã nguồn hay trình duyệt. Quản trị viên có thể dùng phiên nhập stdin riêng vào container để ghi khóa; tránh đưa khóa thành tham số lệnh hoặc lưu vào lịch sử shell. Sau đó tạo lại container ứng dụng để nạp cấu hình. Gói không tự mua dịch vụ, tạo khóa, đăng ký tài khoản hoặc gửi dữ liệu tới nhà cung cấp.

Dịch vụ cần hỗ trợ `response_format.json_schema`, `temperature`, `seed`, `max_tokens`, kết thúc `stop` và dạng `choices[].message.content`. Adapter được kiểm hợp đồng bằng phản hồi giả lập; chưa gọi nhà cung cấp HTTPS thật. Phải chạy lại kiểm nghiệm với model được chọn, không suy ra tương thích từ tên model hoặc nhãn “OpenAI compatible”. Nhánh Qwen qua loopback giữ giao thức đã kiểm riêng trên Mac. Không lấy kết quả này để chứng nhận một model cloud khác.

Một lượt soạn dùng tối đa 4 nguồn, tổng 3.300 ký tự và ba phần, không thử lại tự động; chờ mô hình tối đa 90 giây. Mỗi tài khoản có giới hạn 20 yêu cầu AI trong cửa sổ 24 giờ của tiến trình. Bộ đếm này nằm trong RAM và đặt lại khi khởi động lại, không phải hạn mức chi phí bền vững. Hai đường model có khóa bận riêng. Cần hạn mức chi phí thực tại nhà cung cấp trước pilot bên ngoài.

## Nghiệm thu hai phiên

1. Mở DT-DEMO-01, tải Word bản 1, lưu lại dấu kiểm/tệp để đối chiếu.
2. Đăng xuất rồi đăng nhập lại, mở cùng hồ sơ. Dán nội dung `distribution/demo/DT-DEMO-01-chi-dan-moi.txt` thành nguồn mới. Khi có AI, chọn đúng nguồn, chỉ sửa phản hồi; khi AI chưa bật, dùng chức năng sửa bằng tay trên bản mẫu.
3. Đối chiếu, sửa đề xuất nếu cần, duyệt riêng phần phản hồi. Hệ thống giữ nội dung đã duyệt của các phần còn lại. Một bản duyệt mới có thể chứa phần cũ đã duyệt và phần mới vừa được chấp nhận; không xuất các đề xuất chưa duyệt.
4. Tải Word bản 2, mở lại Word bản 1. Bản 1 phải giữ nguyên; bản 2 phản ánh đúng phần đã duyệt. Thử bản còn `[Luật sư xác nhận]`, chuyên viên bấm duyệt, nhóm khác mở mã hồ sơ và tab cũ ghi đè: máy chủ phải chặn.
5. Khởi động lại dịch vụ; xác nhận hồ sơ và hai bản vẫn còn sau khi đăng nhập lại. Lưu biên bản theo `docs/NGHIEM-THU-WEB.md`.

## Sao lưu và phục hồi

Dừng ứng dụng trước khi sao lưu để có bản SQLite nhất quán: `docker compose -f compose.web.yaml stop app`. Sao chép toàn bộ `/data` qua công cụ sao lưu volume của đơn vị vận hành vào nơi được mã hóa và kiểm soát quyền, rồi `start app`. Bản sao gồm tài khoản, hồ sơ và nhật ký, phải được bảo vệ như dữ liệu gốc. Không gửi bản sao vào Base44 hoặc đưa lên kho mã. Phục hồi bằng cách dừng ứng dụng, khôi phục bản sao vào đúng volume với UID/GID 10001 và quyền thư mục 0700/tệp tài khoản 0600, sau đó khởi động và kiểm đủ hồ sơ/bản Word. Chưa nghiệm thu quy trình sao lưu của một đơn vị hạ tầng cụ thể.

## Giới hạn cần giữ khi giới thiệu

Chưa xuất bản Internet, chưa thử HTTPS với DNS/chứng thư thực, chưa thử AI cloud thật. Chưa có SSO, MFA, phân quyền theo khách hàng, mã hóa ứng dụng cho dữ liệu lưu, sao lưu do nhà cung cấp vận hành hay kiểm xâm nhập độc lập. Lưu trên đĩa/volume cần bảo vệ ở tầng máy chủ. Giới hạn đăng nhập tính theo địa chỉ peer; qua một reverse proxy, nhiều người có thể dùng chung ngưỡng 12 lần/5 phút. Cookie HTTPS có Secure, HttpOnly và SameSite Strict; nếu hết phiên, đăng nhập lại để tiếp tục.

Kho pháp luật là ứng viên. Không tự tính hạn/phí hoặc bảo đảm khả năng đăng ký. Madrid chuyển nguồn WIPO để kiểm chứng riêng. Chưa có rà soát pháp lý của luật sư thật hoặc phép đo tiết kiệm công người dùng thật. Chấm mô phỏng và kiểm kỹ thuật được ghi riêng trong báo cáo. Chỉ đưa hồ sơ khách hàng thật vào sau khi Đại Tín chấp thuận hạ tầng, chính sách dữ liệu và nguồn pháp luật.
