# Pilot Đại Tín trên Railway

Tạo thư mục triển khai từ SQLite pilot công khai. Chạy tại gốc repo và chọn thư mục đích chưa tồn tại.

```sh
node deploy/public-pilot/stage.mjs ../../work/daitin-m12-public-pilot work/public-pilot-hosted-m13
```

Lệnh kiểm sáu câu hỏi, bảy nguồn, định danh model và dấu kiểm từng tài liệu trước khi sao lưu SQLite. Nếu đợt đã có lượt thao tác, rà nội dung đã lưu trước khi quyết định dữ liệu được chuyển. Gói chỉ gồm mã phục vụ pilot, kho công khai và biên nhận phát hành. Bản Word nội bộ, kho nội bộ và khóa đăng nhập nằm ngoài gói.

1. Tạo dự án và dịch vụ riêng trên Railway. Gắn volume tại `/pilot-data`, dùng một replica, cấp tên miền Railway, đặt `PORT=8080` và cổng đích 8080. Cấu hình healthcheck `/healthz`, timeout 180 giây. Bật chế độ tự ngủ nếu phù hợp với thời gian khởi động khi anh Bình mở link. [Railway healthcheck](https://docs.railway.com/deployments/healthchecks) · [Railway serverless](https://docs.railway.com/deployments/serverless)
2. Nạp hai khóa bằng `railway variable set --stdin --skip-deploys PILOT_BINH_KEY` và lệnh tương ứng cho `PILOT_GRADER_KEY`. Đọc từng khóa từ tệp cục bộ vào stdin. Dùng hai khóa hex 64 ký tự riêng cho `binh` và `cham-mu`.
3. Chạy `railway up --detach` từ **thư mục đã tạo ở trên**, trên dịch vụ riêng vừa liên kết. Docker tải trọng số Qwen3-4B-Instruct-2507 Q4_K_M và llama.cpp b12230 đã ghim SHA-256. Dịch vụ cần tối thiểu 4 GiB RAM để chạy cấu hình CPU đã thử. Tạo SQLite từ bản gốc ở lần khởi động đầu tiên. Các lần sau mở lại SQLite trên volume.
4. Kiểm tra `/healthz`, `/pilot`, đăng nhập hai vai trò, quyền truy cập và các dấu kiểm nguồn, câu hỏi, model trên HTTPS. Kiểm lại trạng thái sau khi dịch vụ khởi động lại. Gửi link `/pilot` và khóa riêng từng vai trò sau khi đã xác nhận, rồi mới ngừng đường dẫn tạm.
