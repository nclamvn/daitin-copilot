# Pilot M4 giả lập cục bộ

Pilot dùng 8 ca mô phỏng, ngày đối chiếu cố định theo fixture, cùng Qwen cục bộ và mẫu Word `daitin-v2`. Mỗi ca chạy qua hai phiên, mỗi phiên có hai nhánh. Thứ tự cân bằng 4 ca chạy Bàn hồ sơ trước và 4 ca chạy agent trước. Máy chủ Bàn hồ sơ khởi động lại giữa hai phiên. Agent dùng tiến trình mới và đọc tệp trạng thái đã lưu.

## Chạy lại

Từ thư mục ứng dụng, đặt `DAI_TIN_MODEL_PORT`, `DAI_TIN_MODEL_ID`, `DAI_TIN_MODEL_KEY_FILE`, `DAI_TIN_PLAYWRIGHT` và `DAI_TIN_CHROME` theo máy đang chạy. Model dùng cùng điểm cuối cho hai nhánh. `DAI_TIN_QA_PORT` mặc định 4318. Thư mục fixtures do `copilot/m4/acceptance/fixtures.py` tạo và có `oracle.json`. Mỗi lượt có SQLite và tệp đối chứng riêng.

```sh
node copilot/m4/pilot/rehearse.mjs "$FIXTURES_DIR" "$RESULT_DIR" --browser
"$PILOT_PYTHON" copilot/m4/pilot/check-blind.py "$RUN_DIR/blind" "$FIXTURES_DIR/oracle.json" "$RUN_DIR/mechanical-blind.json"
node copilot/m4/pilot/summarize.mjs "$RUN_DIR"
```

`PILOT_PYTHON` là Python có thư viện đọc DOCX. `RUN_DIR` là thư mục kết quả riêng in ở cuối lượt chạy. Bỏ cờ `--browser` để chạy đường kiểm tra API kỹ thuật chưa có bước sửa giả lập.

## Đọc kết quả

- Trình duyệt tự nhập, chọn hoặc kéo tệp và duyệt bằng thao tác trên giao diện thật. Các yêu cầu API đọc từ trình chạy dùng để xác minh trạng thái và SHA-256.
- Nhánh đối chứng nhận kế hoạch tệp do kịch bản điền. Model và công cụ PDF/SOT/Word dùng chung. Kế hoạch gộp nhiều quyết định, vì vậy số lệnh tệp và số thao tác giao diện có đơn vị khác nhau.
- `simulated-review.mjs` mô phỏng phần sửa tay khi phát hiện thiếu dữ kiện, cụm hàng hóa sai hoặc viện dẫn trong thân Word. Nó dùng dữ kiện chuẩn của fixture. Bản nháp trước sửa và cờ sửa được lưu riêng. Thời gian ngoài lời gọi model gồm các chi phí máy như trình duyệt, đọc lưu trạng thái và xuất tệp.
- Thư mục `blind` dùng mã ngẫu nhiên và chứa Word cùng chỉ mục chỉ có mã ca, phiên, tên tệp. Chạy bộ kiểm theo chỉ mục này trước khi dùng `blind-key.private.json` để gộp điểm theo nhánh. Tệp khóa riêng không thuộc gói gửi người chấm.
- Điểm kỹ thuật tối đa 8 qua bốn nhóm dữ kiện, căn cứ, nội dung, phiên bản. Điểm dựa trên tiêu chí kiểm được trong Word và fixture. Thời gian thao tác chủ động và chất lượng pháp lý do luật sư chấm là hai dữ liệu riêng.
