# Runtime pilot trên Vercel

Adapter dùng cùng core hồ sơ, SOT và Word với bản cục bộ. Không chuyển dữ kiện pháp lý hoặc quyết định duyệt sang model. Gói Node 24 không cần máy Mac chạy; PDF.js thay công cụ Poppler trong nhánh Vercel, giới hạn PDF 2 MiB để phù hợp request web.

## Lưu trạng thái

`pilot/state-v1.json` trong Vercel Blob **private** chứa snapshot SQLite có SHA-256, tài khoản pilot, hash phiên đăng nhập và bộ đếm. Mọi lần đọc dùng `useCache:false`, không dùng bản CDN cũ để quyết định cập nhật. Không có đường API trả snapshot hoặc token Blob ra trình duyệt.

Mỗi Function chỉ dựng SQLite làm thư mục làm việc tạm rồi xóa trong `finally`. ETag/`ifMatch` của Blob cấp lease cho một POST tại một thời điểm. Phiên đang lưu khác nhận 409. DB, phiên và bộ đếm chỉ được công bố cùng một snapshot sau khi xử lý xong; phản hồi thành công và cookie được giữ lại đến khi lưu bền thành công. Lỗi lưu trả 503, không tự phát lại model. Lease hết hạn cho phép phục hồi sau Function bị ngắt.

JSON lớn có thể nhận HTTP GET ETag yếu do nén. Khi gặp `W/`, adapter lấy HEAD metadata mạnh và chỉ dùng nếu khớp đúng validator của nội dung vừa đọc; nếu HEAD đã đổi, trả 409. Không bỏ tiền tố yếu một cách mặc định hoặc gán ETag mới cho dữ liệu cũ. `ifMatch` tiếp tục kiểm thay đổi sau HEAD trước khi ghi.

Hạn mức 20 yêu cầu AI/tài khoản/24 giờ được ghi **trước** dispatch vào snapshot lease. Khi model hoặc Function lỗi, lượt vẫn được tính. Không có cơ chế tự hoàn lại hay thử lại model. Tài khoản ở snapshot riêng là nguồn thẩm quyền cho tất cả instance/deployment; biến môi trường tài khoản chỉ phục vụ bootstrap nếu snapshot cũ chưa có tài khoản. Phiên chỉ lưu SHA-256 của bearer token, cookie gốc không lưu vào snapshot. Đăng xuất và đổi khóa/vai trò được áp dụng trên lần đọc kho kế tiếp.

Các GET xuất Word có thể sinh cache tạm nhưng không ghi snapshot. Tệp Word được dựng xác định từ bản đã duyệt và mẫu đã khóa; không coi cache GET là dữ liệu lưu bền. Kho nguồn bất biến được kiểm và dùng chung trong một isolate để tránh băm lại toàn bộ corpus mỗi request.

## PDF chính thống qua CDN

Vercel Function giới hạn kích thước response, nên các PDF chính thống lớn được build thành `dist/__sources/<sha256>.pdf`. Build chỉ đọc danh mục PDF của SOT ứng viên và `copilot/sources.json`, kiểm miền nguồn chính thống, tên tệp, loại dữ liệu, nơi lưu và SHA-256 trước khi tạo output. Không glob thư mục hồ sơ hoặc đưa PDF khách hàng, SQLite hay khóa lên CDN.

Đường dẫn nguồn cũ vẫn đi qua xác thực và kiểm pin trước khi 302 tới tài nguyên hash bất biến; pin sai trả 409, mã nguồn không có trả 404. Browser giữ fragment trang PDF khi theo redirect không có fragment mới. Nội dung PDF chính thống là nguồn công khai, có thể truy cập trực tiếp tại tài nguyên hash. `dist` chứa `__sources` và 13 tài nguyên giao diện trong allowlist chính xác, không có HTML: font, logo, CSS/JS đăng nhập và các CSS/module trình duyệt của bàn hồ sơ. Những tài nguyên này được phục vụ trực tiếp, không đọc snapshot riêng hoặc chiếm hàng đợi Function. Quy tắc filesystem phục vụ tài nguyên trước, các đường khác tiếp tục Function; trang gốc vẫn chuyển vào bàn hồ sơ, HTML và API vẫn xác thực. Không đưa module máy chủ, tài liệu hồ sơ, mẫu Word máy chủ hoặc khóa vào CDN.

## Giới hạn pilot

- Snapshot JSON tối đa 16 MiB. Khi đầy, thay đổi mới bị từ chối và giữ snapshot trước. Kiến trúc này phù hợp pilot nhỏ, chưa phải cơ sở dữ liệu giao dịch cho nhiều người dùng.
- Có thể thêm hồ sơ trong giới hạn gói; tám hồ sơ khởi tạo đều là mô phỏng. Không đưa hồ sơ khách hàng thật khi chưa được Đại Tín chấp thuận.
- POST serialize toàn pilot, kể cả đăng nhập và phân tích PDF. Một lượt model có thể khiến lượt ghi khác chờ hoặc nhận 409; GET vẫn đọc bản đã công bố gần nhất. Không hứa hiệu năng làm việc đồng thời lớn.
- Lease 130 giây, model tối đa 90 giây, Function 180 giây. ETag ngăn request cũ ghi đè khi lease đã bị request khác thay. Storage SDK có thể thử lại thao tác lưu; core không tự lặp suy luận.
- Bộ đếm và phiên bền qua cold start khi POST đã commit. Thao tác dọn phiên hết hạn trong GET không cần ghi lại vì kiểm hạn và khóa luôn chạy trên lần truy cập sau.
- Chỉ có log model/intake tối đa 200 mục trong snapshot, cùng các bản nháp/bản duyệt nguồn. Đây không phải nhật ký chống sửa bởi quản trị viên hoặc chứng cứ pháp lý được chứng nhận.

## Khởi tạo và cấu hình

Đặt `BLOB_READ_WRITE_TOKEN` và `DAI_TIN_M5_ACCOUNTS_JSON` của **môi trường mới**, rồi chạy `node deploy/seed-vercel.mjs` trong phiên riêng. Script kiểm dấu nguồn mô phỏng và chỉ tạo snapshot mới, không ghi đè kho đã có. Không đặt token/khóa trong Git, lệnh có tham số rõ khóa hoặc tài nguyên public.

Đặt `DAI_TIN_PUBLIC_ORIGIN` theo URL HTTPS chính thức. Vercel system URL của deployment được thêm vào allowlist chính xác; không cấp quyền theo header forwarded do người gửi chọn. Gateway chỉ dùng OIDC máy chủ khi endpoint đúng `https://ai-gateway.vercel.sh/v1/chat/completions`; các endpoint khác cần tệp khóa riêng và HTTPS. Không tự chuyển provider hoặc mua thêm ngân sách.

### Khóa nguồn cho pilot sáng chế

Giá trị máy chủ `DAI_TIN_ANONYMIZED_PATENT_PILOT` là nguyên JSON khóa phiên bản 1 do lệnh `preflight` tạo. Một khóa gồm mã hồ sơ, ngày đối chiếu, dấu kiểm manifest và ba vai trò với SHA-256 PDF, trang vật lý, khoảng vị trí UTF-16 và SHA-256 của đoạn trích. Vercel và agent trực tiếp dùng cùng khóa đã duyệt. Biến để trống hoặc cấu hình kiểu chỉ có ba SHA-256 của bản trước sẽ tắt quyền nhận hồ sơ ẩn danh. [Quy trình chuẩn bị và nghiệm thu](patents/acceptance/m7-pilot/human/README.md)

Kiểm dung lượng sản xuất trước khi bật khóa. Tổng ba PDF tối đa 2 MiB. Khi nhận hồ sơ lần đầu, kho kiểm thêm 512 KiB dung lượng dự kiến cho hai Word và phần lưu liên quan dưới giới hạn PDF/Word 6 MiB và SQLite 10 MiB. Đây là ước tính lúc tiếp nhận. Mỗi lần ghi tiếp tục kiểm giới hạn bằng dung lượng thực tế. Nhập lại cùng khóa và dữ kiện ban đầu mở hồ sơ đã lưu, kể cả sau khi phát hành Word 2. Hai yêu cầu ghi đến đồng thời có thể nhận 409 từ lease Vercel. Gửi lại thao tác nhập khi lease đã kết thúc sẽ mở cùng hồ sơ.

## Bằng chứng Builder

Tám ca `test/runtime.test.mjs` đạt tại máy phát triển: OIDC không cần API key lưu, preflight trước đọc Blob, lease cross-instance, hash phiên và logout qua instance mới, không phản hồi cookie/thành công khi commit lỗi, bảo lưu quota sau lỗi model, bỏ cache GET và cổng duyệt không cho bản sửa tay thiếu nguồn. Các test dùng Blob giả lập có ETag và core thật cho ca duyệt; không tự thay cho nghiệm thu Blob/AI/HTTPS trên Vercel thật. Parent thực hiện kiểm triển khai độc lập và ghi kết quả phát hành riêng.
