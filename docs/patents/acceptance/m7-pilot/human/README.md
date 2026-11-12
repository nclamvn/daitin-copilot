# Pilot sáng chế với luật sư Đại Tín

Từ bản 0.7.9, Workspace và agent trực tiếp dùng chung một khóa cho bộ nguồn ẩn danh của pilot. Đây là pilot một ca mới, có anh Bình làm ở cả hai nhánh và một luật sư khác chấm. Cùng `google/gemini-2.5-flash-lite`, bộ PDF, đoạn được chọn, hai yêu cầu, thang chấm và điều kiện ra Word. Chỉ người điều phối giữ ánh xạ và yêu cầu phiên hai.

## Chuẩn bị dữ liệu

1. Đại Tín chọn một hồ sơ chưa dùng trong phát triển và cho phép thử trên Vercel và Gateway. Nhận ba PDF đã ẩn danh gồm thông báo, yêu cầu đang xét và D1, ngày đối chiếu, chỉ dẫn phiên một và thay đổi nghiệp vụ phiên hai. Dùng mã và nhãn trung tính, kiểm bản hiển thị, lớp chữ và metadata tại máy trước khi xuất bản pilot. Chỉ nguồn được duyệt đi vào gói.
2. Ghi SHA-256 của ba PDF, số trang vật lý và nguyên văn từng đoạn trong manifest. Khi một đoạn xuất hiện nhiều lần trên cùng trang, thêm `start` và `end` theo vị trí UTF-16 trong lớp chữ PDF.js, với `end` là vị trí sau ký tự cuối. Gói ba PDF tối đa 2 MiB, mỗi PDF tối đa 12 trang. Kiểm dung lượng kho Vercel còn đủ cho tài liệu và hai Word.
3. Chạy `preflight` để trích đúng lớp chữ và tạo tệp khóa quyền 0600. Điều phối rà soát tệp khóa và dùng nguyên JSON làm giá trị biến máy chủ Vercel `DAI_TIN_ANONYMIZED_PATENT_PILOT`. Dùng cùng tệp đã duyệt cho agent và công cụ nghiệm thu. Tệp khóa chứa dấu kiểm manifest, mã tham chiếu, ngày đối chiếu và dấu kiểm PDF, trang, vị trí cùng dấu kiểm đoạn cho từng vai trò. Mọi thay đổi manifest cần khóa lại và đăng ký lại trước khi chạy. Giữ manifest, tài liệu, tệp khóa và biên nhận trong thư mục riêng, ngoài Git và gói build. Bật cấu hình sau khi bộ nguồn được phép dùng. Xác thực tài khoản Bình mở đúng hồ sơ, PDF và Word của pilot và tài khoản khác bị chặn.
4. Bốc thăm nhánh chạy trước và đổi thứ tự ở phiên hai. Người quan sát dùng đồng hồ HTML để tách công người dùng, chờ hệ thống và gián đoạn. Anh Bình có thể tự ghi nếu phù hợp, chọn đúng chế độ trên đồng hồ để báo phần công bấm giờ. Ghi giao diện, thiết bị và mạng của từng nhánh trong sổ điều phối. Với một ca, thứ tự đã đổi vẫn có thể ảnh hưởng kết quả.

## Chạy hai phiên

**Phiên một.** Bắt đầu đo khi nhận bộ nguồn, gồm thời gian nhập/chọn, mở hồ sơ, giao việc, rà nguồn, sửa, duyệt và tải Word 1. Anh Bình tự quyết định nội dung và xác nhận từng phần. Người quan sát ghi bước có nghĩa theo cùng quy tắc ở cả hai nhánh. Đóng cả hai phiên và niêm phong SHA-256 Word 1 trước khi mở yêu cầu mới.

**Phiên hai.** Mở lại mỗi nhánh trong phiên mới. Nhận cùng chỉ dẫn cập nhật, sửa riêng phản hồi, rà và duyệt, tải Word 2. Kiểm ma trận và Word 1 giữ dấu kiểm. Ghi cả phần sửa lại, lỗi hoặc lần thử không hoàn tất. Chấm chất lượng theo sàn 8/10 và qua cổng lỗi nghiêm trọng. So chênh thời gian chủ động và số bước ở từng phiên và tổng. Chênh lệch trên một ca là quan sát, chưa dùng để suy rộng.

## Công cụ của điều phối

Chạy tại gốc repository. Các biến đường dẫn trỏ vào thư mục riêng được cấp quyền. `ACCOUNTS` là tệp thông tin truy cập của máy điều phối, giữ ngoài gói người chấm. `MANIFEST` do điều phối giữ để chuẩn bị yêu cầu phiên hai. Giao riêng công việc từng phiên cho người thao tác.

```sh
PILOT=docs/patents/acceptance/m7-pilot

# Kiểm offline lớp chữ PDF.js và tạo tệp khóa nguồn để đăng ký ở máy chủ.
node "$PILOT/human/pilot.mjs" preflight "$MANIFEST" "$CONFIG"
# Sau khi điều phối duyệt và đăng ký đúng tệp khóa trên Vercel.
export DAITIN_PILOT_SOURCE_LOCK_FILE="$CONFIG"

# Phiên 1 của agent có công cụ, anh Bình trực tiếp làm trên máy pilot được phép dùng Gateway.
DAITIN_PILOT_LIVE=1 DAI_TIN_PILOT_AUTHORIZED_ANONYMIZED=1 \
  node --env-file=.env.vercel.local "$PILOT/run.mjs" human-direct "$MANIFEST" "$DIRECT" 1

# Điều phối tải lại đúng Word 1 của Workspace sau khi anh Bình xuất.
node "$PILOT/human/pilot.mjs" checkpoint "$MANIFEST" "$CASE_UUID" "$ACCOUNTS" "$CHECKPOINT"

# Phiên 2 của agent, chạy lại bằng tiến trình mới sau khi điều phối mở yêu cầu mới.
DAITIN_PILOT_LIVE=1 DAI_TIN_PILOT_AUTHORIZED_ANONYMIZED=1 \
  node --env-file=.env.vercel.local "$PILOT/run.mjs" human-direct "$MANIFEST" "$DIRECT" 2

# Đối chiếu ba PDF, Word hai phiên, người duyệt, Gemini và bốn biên nhận đồng hồ.
node "$PILOT/human/pilot.mjs" collect "$MANIFEST" "$CASE_UUID" "$ACCOUNTS" "$CHECKPOINT" "$DIRECT" "$CLOCKS" "$OUT"

# Gửi thư mục reviewer theo quyền đã có. Thu lại tệp điểm đã điền.
node "$PILOT/human/pilot.mjs" score "$OUT" "$GRADES"
```

Nhánh Workspace mở tại [Bàn hồ sơ sáng chế](https://daitin-copilot.vercel.app/patents/). Nhánh agent cần một máy pilot có runtime Node, TTY và danh tính Gateway của dự án. Người thao tác dùng cùng bộ nguồn qua công cụ `read_case`, tự rà, sửa và xác nhận để xuất Word. Giữ tệp phiên một giữa hai lần mở. Đo bằng đồng hồ ngoài ứng dụng cho cả hai nhánh. Thời gian chờ khi người thao tác không làm việc nằm ở cột chờ máy. Đếm một lần cho mỗi hành vi hoàn chỉnh, gồm xác nhận nguồn, gửi việc, xác nhận từng phần và tải bản đã duyệt. Ghi riêng khi phải lặp thao tác.

`collect` đối chiếu dấu kiểm khóa nguồn trên hồ sơ, bản duyệt và biên nhận model của hai nhánh, kiểm đúng trang và vị trí đoạn, rồi xác minh ma trận và Word 1 qua hai phiên. Kết quả gồm thư mục `reviewer` với hai mã ngẫu nhiên, căn cứ theo trang, bản trình bày chung và tệp điểm trống. Giữ `blind-key.json`, thời gian, log và Word nhận diện tại điều phối. Chỉ mở ánh xạ sau khi đã khóa tệp điểm. Nếu một phiên thiếu đầu ra, giữ biên nhận và ghi ca chưa hoàn tất trong sổ điều phối, tiếp tục từ đúng trạng thái đã lưu khi lỗi có thể phục hồi.
