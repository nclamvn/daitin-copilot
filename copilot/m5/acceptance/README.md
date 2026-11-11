# Nghiệm thu M5

Pilot tự động có người dùng và luật sư giả lập nằm trong [bộ chạy M5](../pilot/README.md). Bộ này chạy đủ 30 ca trên trình duyệt và công cụ tệp, ghi thao tác, khóa đầu ra, chấm ẩn nhánh, thử sáu bản cố ý sai rồi mới giải mã để so sánh.

## Chạy lại trên máy

Dùng Node.js 24 và mô hình cục bộ của M2. Chạy pilot với thư mục tài khoản và SQLite riêng. Công cụ nghiệm thu tạo hồ sơ mô phỏng, diễn tập công bố và khôi phục mẫu trong chính kho đã chọn.

```sh
export DAI_TIN_M5_DIR="$PWD/../../work/daitin-m5/qa"
export DAI_TIN_M5_ACCOUNTS="$DAI_TIN_M5_DIR/accounts.json"
export DAI_TIN_M5_BASE=http://127.0.0.1:4321
PORT=4321 ./copilot/start-m5.sh
```

Trong cửa sổ khác, đặt cùng biến cấu hình và chạy lệnh sau. Tùy chọn kiểm thu hồi quyền thay đổi tạm tệp tài khoản QA và khôi phục tệp sau phép thử.

```sh
node --test test/*.test.mjs
export DAI_TIN_MODEL_PORT=4313 DAI_TIN_MODEL_ID=daitin-qwen3-4b-2507
export DAI_TIN_MODEL_KEY_FILE="$PWD/../../work/daitin-m2-runtime/engine.key"
node copilot/m5/acceptance/rehearse.mjs "$DAI_TIN_M5_DIR/results" --isolated-revocation
```

Để chạy giao diện qua hai cửa sổ mới, đặt `DAI_TIN_PLAYWRIGHT` và `DAI_TIN_CHROME` theo máy. Lệnh kiểm dùng cùng mô hình và tải hai bản Word trong thư mục QA.

```sh
node copilot/m5/acceptance/browser.mjs "$DAI_TIN_M5_DIR/browser"
```

## Phân loại bằng chứng

- 12 câu hỏi tra cứu, 8 ca phải làm rõ hoặc dừng và 10 hồ sơ hai phiên. Đây là các ca mô phỏng được soạn cho nghiệm thu kỹ thuật. Kết quả chấm mù độc lập cần thu riêng.
- Hai nhánh hồ sơ dùng cùng mô hình, dữ kiện, công cụ tra cứu, soạn và xuất Word. Nhánh đối chứng chạy công cụ trên tệp và khởi động tiến trình mới mỗi phiên. Báo cáo lưu thời gian chạy và dấu kiểm đầu vào, đầu ra theo từng phiên.
- Chỉ gửi thư mục `blind` và phiếu chấm cho người rà. Điều phối viên giữ `arm-key.json` và `report.json`, giải mã sau khi khóa điểm.
- Đo người dùng bằng tổng thời gian chủ động qua hai phiên trên mỗi hồ sơ, tách thời gian chờ model và thời gian nghỉ. Tính mức giảm theo từng cặp hợp lệ, rồi lấy trung vị. Tách tỷ lệ dừng hoặc bỏ cuộc khỏi số đo của các cặp hoàn tất. Cổng đề xuất là chất lượng tương đương, không lỗi nghiêm trọng và ít nhất 20% giảm thời gian thao tác chủ động.
