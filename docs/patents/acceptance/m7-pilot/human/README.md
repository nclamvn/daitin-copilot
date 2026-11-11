# Pilot sáng chế với luật sư Đại Tín

Bản tham chiếu 0.7.7 ở commit `651a008`. Gói triển khai kế tiếp bổ sung cổng hồ sơ đã ẩn danh và rút thao tác duyệt/xuất. Đây là pilot một ca mới, có anh Bình làm ở cả hai nhánh và một luật sư khác chấm. Cùng `google/gemini-2.5-flash-lite`, bộ PDF, đoạn được chọn, hai yêu cầu, thang chấm và điều kiện ra Word. Chỉ người điều phối giữ ánh xạ và yêu cầu phiên hai.

## Chuẩn bị dữ liệu

1. Đại Tín chọn một hồ sơ chưa dùng trong phát triển và cho phép thử trên Vercel và Gateway. Nhận ba PDF đã ẩn danh gồm thông báo, yêu cầu đang xét và D1, ngày đối chiếu, chỉ dẫn phiên một và thay đổi nghiệp vụ phiên hai. Dùng mã và nhãn trung tính, kiểm bản hiển thị, lớp chữ và metadata tại máy trước khi xuất bản pilot. Chỉ nguồn được duyệt đi vào gói.
2. Khóa SHA-256 của ba PDF, số trang vật lý và nguyên văn từng đoạn. Dùng một manifest như mẫu. Gói ba PDF tối đa 2 MiB, mỗi PDF tối đa 12 trang. Kiểm dung lượng kho Vercel còn đủ cho tài liệu và hai Word. Mục nguồn ngoài gói chỉ xuất hiện dưới dạng việc cần luật sư kiểm.
3. Điều phối dùng giá trị `DAI_TIN_ANONYMIZED_PATENT_PILOT` phía máy chủ theo đúng ba digest vai trò. Để biến trống trước khi có bộ nguồn được phép dùng. Giữ manifest, tài liệu và biên nhận trong thư mục làm việc riêng, ngoài Git và gói build. Khai báo và triển khai biến qua kênh quản trị Vercel. Tài khoản Bình giữ nguyên đăng nhập. Xác thực anh Bình thấy chế độ nhập ẩn danh và tài khoản khác bị chặn khi mở trực tiếp hồ sơ, PDF và Word của pilot.
4. Bốc thăm nhánh chạy trước và đổi thứ tự ở phiên hai. Người quan sát dùng đồng hồ HTML để tách công người dùng, chờ hệ thống và gián đoạn. Anh Bình có thể tự ghi nếu phù hợp, chọn đúng chế độ trên đồng hồ để báo phần công bấm giờ. Ghi giao diện, thiết bị và mạng của từng nhánh trong sổ điều phối. Với một ca, thứ tự đã đổi vẫn có thể ảnh hưởng kết quả.

## Chạy hai phiên

**Phiên một.** Bắt đầu đo khi nhận bộ nguồn, gồm thời gian nhập/chọn, mở hồ sơ, giao việc, rà nguồn, sửa, duyệt và tải Word 1. Anh Bình tự quyết định nội dung và xác nhận từng phần. Người quan sát ghi bước có nghĩa theo cùng quy tắc ở cả hai nhánh. Đóng cả hai phiên và niêm phong SHA-256 Word 1 trước khi mở yêu cầu mới.

**Phiên hai.** Mở lại mỗi nhánh trong phiên mới. Nhận cùng chỉ dẫn cập nhật, sửa riêng phản hồi, rà và duyệt, tải Word 2. Kiểm ma trận và Word 1 giữ dấu kiểm. Ghi cả phần sửa lại, lỗi hoặc lần thử không hoàn tất. Chấm chất lượng theo sàn 8/10 và qua cổng lỗi nghiêm trọng. So chênh thời gian chủ động và số bước ở từng phiên và tổng. Chênh lệch trên một ca là quan sát, chưa dùng để suy rộng.

## Công cụ của điều phối

Chạy tại gốc repository. Các biến đường dẫn trỏ vào thư mục riêng được cấp quyền. `ACCOUNTS` là tệp thông tin truy cập của máy điều phối, giữ ngoài gói người chấm. `MANIFEST` do điều phối giữ để chuẩn bị yêu cầu phiên hai. Giao riêng công việc từng phiên cho người thao tác.

```sh
PILOT=docs/patents/acceptance/m7-pilot

# Kiểm offline đúng lớp chữ PDF.js và tạo tệp digest để cấu hình máy chủ.
DAI_TIN_PDF_ENGINE=pdfjs node "$PILOT/human/pilot.mjs" preflight "$MANIFEST" "$CONFIG"

# Phiên 1 của agent có công cụ, anh Bình trực tiếp làm trên máy pilot được phép dùng Gateway.
DAITIN_PILOT_LIVE=1 DAITIN_PILOT_AUTHORIZED_ANONYMIZED=1 DAI_TIN_PDF_ENGINE=pdfjs \
  node --env-file=.env.vercel.local "$PILOT/run.mjs" human-direct "$MANIFEST" "$DIRECT" 1

# Điều phối tải lại đúng Word 1 của Workspace sau khi anh Bình xuất.
node "$PILOT/human/pilot.mjs" checkpoint "$MANIFEST" "$CASE_UUID" "$ACCOUNTS" "$CHECKPOINT"

# Phiên 2 của agent, chạy lại bằng tiến trình mới sau khi điều phối mở yêu cầu mới.
DAITIN_PILOT_LIVE=1 DAITIN_PILOT_AUTHORIZED_ANONYMIZED=1 DAI_TIN_PDF_ENGINE=pdfjs \
  node --env-file=.env.vercel.local "$PILOT/run.mjs" human-direct "$MANIFEST" "$DIRECT" 2

# Đối chiếu ba PDF, Word hai phiên, người duyệt, Gemini và bốn biên nhận đồng hồ.
node "$PILOT/human/pilot.mjs" collect "$MANIFEST" "$CASE_UUID" "$ACCOUNTS" "$CHECKPOINT" "$DIRECT" "$CLOCKS" "$OUT"

# Gửi thư mục reviewer theo quyền đã có. Thu lại tệp điểm đã điền.
node "$PILOT/human/pilot.mjs" score "$OUT" "$GRADES"
```

Nhánh Workspace mở tại [Bàn hồ sơ sáng chế](https://daitin-copilot.vercel.app/patents/). Nhánh agent cần một máy pilot có runtime Node, TTY và danh tính Gateway của dự án. Người thao tác dùng cùng bộ nguồn qua công cụ `read_case`, tự rà, sửa và xác nhận để xuất Word. Giữ tệp phiên một giữa hai lần mở. Đo bằng đồng hồ ngoài ứng dụng cho cả hai nhánh. Thời gian chờ khi người thao tác không làm việc nằm ở cột chờ máy. Đếm một lần cho mỗi hành vi hoàn chỉnh, gồm xác nhận nguồn, gửi việc, xác nhận từng phần và tải bản đã duyệt. Ghi riêng khi phải lặp thao tác.

`collect` tạo thư mục `reviewer` chứa hai mã ngẫu nhiên, căn cứ theo trang và bản trình bày chung, cùng tệp điểm trống. Giữ `blind-key.json`, thời gian, log và Word nhận diện tại điều phối. Chỉ mở ánh xạ sau khi đã khóa tệp điểm. Nếu một phiên thiếu đầu ra, giữ biên nhận và ghi ca chưa hoàn tất trong sổ điều phối, tiếp tục từ đúng trạng thái đã lưu khi lỗi có thể phục hồi.
