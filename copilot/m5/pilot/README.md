# Pilot M5 tự động

Bộ chạy mô phỏng người dùng bằng trình duyệt và một nhánh agent dùng công cụ trên tệp. Dữ kiện có 12 ca tra cứu, 8 ca cần dừng hoặc làm rõ và 10 hồ sơ qua hai phiên. Hai nhánh dùng cùng model soạn, nguồn, công cụ đối chiếu và mẫu Word. Nhánh tra cứu dùng công cụ xác định và không cần gọi model sinh câu trả lời.

## Chạy pilot

Khởi động mô hình cục bộ có sẵn của M2. Đặt các biến `DAI_TIN_MODEL_PORT`, `DAI_TIN_MODEL_ID`, `DAI_TIN_MODEL_KEY_FILE`, `DAI_TIN_PLAYWRIGHT` và `DAI_TIN_CHROME` theo máy. Bộ chạy tự tạo kho QA và tài khoản riêng, mở máy chủ cục bộ tại cổng `DAI_TIN_QA_PORT` (mặc định 4323), rồi đóng máy chủ và trình duyệt sau khi chạy.

```sh
node copilot/m5/pilot/run.mjs ../../work/daitin-m5-automated
```

Dòng cuối chỉ ra thư mục lượt chạy. Dùng thư mục đó cho ba lệnh tiếp theo.

```sh
python3 copilot/m5/pilot/extract.py <thu-muc-luot-chay>
node copilot/m5/pilot/grade.mjs <thu-muc-luot-chay>
node copilot/m5/pilot/grade.mjs <thu-muc-luot-chay> --labels --calibrate
node copilot/m5/pilot/summarize.mjs <thu-muc-luot-chay>
```

Chấm đọc nội dung từ Word đã xuất và JSON thực tế, kiểm dấu tệp rồi chấm với dữ kiện và trích đoạn trang PDF. Bộ chấm có kiểm theo quy tắc và một lượt LLM đóng vai luật sư. Luật chấm được lưu dấu kiểm, điểm khóa trước khi bộ tổng hợp mở khóa nhánh. Đầu vào chấm giống hệt nhau được dùng lại kết quả theo dấu kiểm. Sáu bản cố ý sai được chấm riêng và không cộng vào 30 ca.

Lượt hiệu chuẩn nhãn có hai ca đối chứng hợp lệ và sáu lỗi cố ý. Báo cáo đầu ngày 11/11/2026 ghi nhận bộ chấm số cho điểm mâu thuẫn với nhận xét, còn bộ chấm nhãn bỏ sót bốn lỗi. Điểm thô được giữ để audit. Bộ tổng hợp ghi cổng ngữ nghĩa chưa đạt và không suy ra chất lượng pháp lý hoặc công thao tác của người thật từ các điểm này.

## Giới hạn phép đo

Các ca đã từng dùng trong phát triển nên không chứng minh kết quả trên dữ liệu chưa thấy. Chính sách người dùng giả lập có thể sửa một lượt theo nguồn và ghi mọi phần phải sửa. LLM chấm dùng cùng họ model và điểm cuối với model soạn. Điểm mô phỏng cần được luật sư thật kiểm chứng.

Thời gian tổng đo từ trước khi mở phiên trình duyệt hoặc chạy tiến trình đối chứng đến khi xong đầu ra. Thời gian model, số thao tác trình duyệt, số thao tác công cụ tệp và ký tự nhập được ghi riêng. Thao tác công cụ có thể gộp nhiều công việc nên số lượng không quy đổi trực tiếp sang số lần bấm. `humanActiveMs` để trống cho đến khi có số đo người dùng. Cổng giảm 20% công thao tác không được quyết định bằng thời gian chạy máy.
