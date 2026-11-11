# Agent trực tiếp cho pilot sáng chế có luật sư thao tác

Nhánh này chạy trên máy điều phối có Node 24, phụ thuộc đã cài của ứng dụng, PDF.js và cấu hình máy chủ dùng Gemini 2.5 Flash-Lite qua Vercel AI Gateway. Anh Bình thao tác ở terminal và trình soạn thảo trên máy được phép sử dụng. Điều phối viên giữ cấu hình Gateway ở máy, ngoài thư mục giao hồ sơ.

## Chuẩn bị nguồn chung

Đặt manifest ngoài checkout Git cùng các PDF ẩn danh đã được Đại Tín cho phép lưu trên Vercel và gửi đoạn được chọn qua Gateway. Dùng cấu trúc M7 với `version: 1`, `synthetic: false`, `anonymized: true` và một mục trong `cases` cho pilot một hồ sơ. Mỗi mục dùng mã `P01` đến `P08`, mã tham chiếu ẩn danh, tên ẩn danh, ngày đối chiếu, chỉ dẫn và nhiệm vụ riêng cho hai phiên. Mỗi vai trò `notice`, `claim` và `d1` có đường dẫn tương đối, tên ẩn danh, SHA-256 của PDF, trang vật lý và nguyên văn đoạn đã khóa. Nhánh Workspace dùng đúng bộ ba PDF và đoạn này. Mỗi PDF tối đa 12 trang, cả bộ tối đa 2 MiB.

Điều phối viên khóa manifest trước khi bắt đầu. Giữ nhiệm vụ phiên 2 trong manifest do điều phối viên giữ và chỉ giao phiếu phiên 2 khi phiên 1 của cả hai nhánh đã kết thúc. Chạy kiểm tệp từ thư mục gốc ứng dụng.

```sh
DAI_TIN_PDF_ENGINE=pdfjs node docs/patents/acceptance/m7-pilot/run.mjs validate-human /duong-dan-rieng/cases.json
```

## Phiên 1 và phiên 2

Điều phối viên chạy lệnh dưới đây với cấu hình Gateway đã duyệt. Dùng thư mục kết quả riêng quyền 0700 ngoài checkout Git.

```sh
DAITIN_PILOT_LIVE=1 DAI_TIN_PILOT_AUTHORIZED_ANONYMIZED=1 DAI_TIN_PDF_ENGINE=pdfjs \
  node --env-file=/duong-dan-rieng/gateway.env docs/patents/acceptance/m7-pilot/run.mjs \
  human-direct /duong-dan-rieng/cases.json /duong-dan-rieng/ket-qua 1
```

1. Anh Bình đọc nhiệm vụ, bắt đầu trên phiếu đo và xác nhận giao việc. Agent gọi công cụ `read_case` để nạp đúng bộ PDF, rồi soạn dựa trên đoạn đã khóa.
2. Mở tệp rà soát JSON được in ra trong terminal và xem PDF tại `direct-workspace`. Nếu cần, sửa nhận định hoặc phản hồi trong tệp rà soát. Khi sửa trích dẫn, giữ nguyên văn trong các đoạn đã khóa và giữ đúng mã nguồn.
3. Xác nhận đã rà và duyệt từng phần. Phiên 1 duyệt ma trận và phản hồi. Phiên 2 chỉ duyệt phản hồi. Để tạm dừng khi còn cần sửa, bỏ qua xác nhận. Chạy lại đúng phiên, dùng lại tệp rà soát đã lưu.
4. Mở Word ở đường dẫn được in ra và kết thúc ghi thời gian. Dùng một lệnh mới với đối số cuối `2` cho phiên sau. Runner kiểm lại ma trận đã duyệt, Word 1 và PDF trước khi mở dữ kiện cập nhật.

Tách thời gian thao tác người dùng khỏi thời gian chờ model, đọc PDF và xuất Word trên phiếu đo chung. `direct.json` giữ biên nhận model, nguồn, quyết định từng phần, bản xuất và bằng chứng bảo toàn phiên bản. Xác nhận của anh Bình là xác nhận tại terminal. Người chấm độc lập chỉ nhận phiếu mù do điều phối viên trích xuất. Khi đoạn nguyên văn lặp trên một trang, ghi thêm hai vị trí UTF-16 `start` và `end` từ cùng lần trích để hai nhánh dùng đúng vị trí đã chọn.

Nếu Gateway báo 429, điều phối viên kiểm biên nhận rồi chờ ít nhất 75 giây và tuân theo thời gian chờ của Gateway. Có thể bật `DAITIN_PILOT_RETRY_429=1` để gửi lại đúng lượt bị từ chối một lần. Giữ nguyên thư mục nếu kết quả gửi chưa rõ hoặc dấu kiểm thay đổi. Trường hợp khóa còn sau khi tiến trình bị dừng đột ngột, điều phối viên xác minh tiến trình đã kết thúc trước khi dọn khóa `direct.lock`.
