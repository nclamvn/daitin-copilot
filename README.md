# Đại Tín Research · MVP 01

Lát cắt đầu tiên theo PRD và concept đã chốt. Phạm vi là **nhãn hiệu Việt Nam theo tuyến quốc gia**, với dữ liệu từ 01/04/2026 đến mốc đối chiếu nguồn 10/11/2026. Bản cục bộ dành cho thử nghiệp vụ bằng dữ liệu minh họa và văn bản công khai.

## Từ thông báo PDF đến Word M4

Mở [Bàn hồ sơ Đại Tín](http://127.0.0.1:4314/copilot/m3/workspace/). Khi tạo hồ sơ, xác nhận quyền dùng dữ liệu pilot trước khi chọn hoặc kéo PDF vào ô thông báo. Xem ảnh trang cạnh lớp chữ, chọn đoạn để soạn và xác nhận dữ kiện. Nếu trang thiếu lớp chữ, chọn trang và nhập đoạn bằng tay. Tệp gốc và dấu kiểm lưu cùng hồ sơ. Sau khi duyệt, chọn **Tải Word** từ đúng bản duyệt. Word dùng mẫu văn bản nội bộ, có thể tiếp tục chỉnh trong Word.

M4 chạy cục bộ với Poppler (`pdfinfo`, `pdftotext`, `pdftoppm`) và Node.js 24. Giới hạn mỗi PDF là 4 MiB và 12 trang. Chọn tối đa 3 đoạn, tổng 1.100 ký tự cho nguồn thông báo đưa vào model. Mở lại nguồn để xem đúng trang. Hạn phản hồi được ghi theo thông báo hoặc do người rà nhập tay. Mẫu Word không có tác vụ gửi hoặc nộp. Đặt `DAI_TIN_M4=0` để chạy bề mặt M3 cũ.

Mã nghiệm thu trong `copilot/m4/acceptance`. `fixtures.py` tạo tám PDF mô phỏng. `run.mjs <fixtures> <work>` chạy kiểm tra đầu vào và một ca đối chứng thật qua hai phiên. `direct.mjs` dùng cùng công cụ PDF, SOT, Qwen và bộ xuất Word cho nhánh file.

## Hồ sơ phản hồi thẩm định M3

Mở [Bàn hồ sơ](http://127.0.0.1:4314/copilot/m3/workspace/) khi M3 đang chạy. [Chuẩn thiết kế](copilot/m3/workspace/DESIGN.md) ghi bố cục, trạng thái và quy tắc mở rộng. [Màn M3 ban đầu](http://127.0.0.1:4314/copilot/m3/) đọc cùng kho hồ sơ. Tạo hồ sơ từ thông báo và chỉ dẫn gốc, soạn bản nháp, rồi duyệt từng phần. Khi quay lại, mở đúng mã hồ sơ, lưu chỉ dẫn bổ sung, chọn phần cần sửa và đối chiếu với nội dung đã duyệt. Mỗi lần duyệt tạo bản xuất mới khi đã có đủ ba phần được duyệt. Bản xuất cũ vẫn tải được theo số bản.

Cần Node.js 24 và mô hình Qwen của pilot M2 đang chạy. Từ thư mục ứng dụng:

```sh
./copilot/start-m3.sh
```

Hồ sơ cục bộ mặc định nằm trong `../../work/daitin-m3/local.sqlite`. Có thể chọn vị trí khác bằng `DAI_TIN_M3_STORE`. Pilot dùng văn bản dán hoặc tệp `.txt` và `.md` UTF-8, tối đa 1.100 ký tự mỗi nguồn và 3.300 ký tự cho bộ nguồn một lượt. Bản duyệt nội bộ xuất Markdown. Dùng hồ sơ mô phỏng hoặc đã ẩn danh và được phép, trên máy được kiểm soát.

## Bàn làm việc Copilot M1

Mở [Đại Tín IP Workbench](http://127.0.0.1:4312/copilot/) để rà hồ sơ, tra Nice và sự kiện chuyển công bố, đính kèm nguồn rồi xuất phiếu. [Hướng dẫn M1](copilot/README.md) có cách chạy, phạm vi và quy trình cập nhật.

## Bản thử kho dữ liệu SOT

Bản ứng viên dùng nguồn đã mở rộng và có cổng duyệt riêng. Xem [hướng dẫn SOT](sot/README.md) để tra phạm vi, quy trình cập nhật và cách đưa cho luật sư rà soát.

```sh
PORT=4311 DAI_TIN_CORPUS_MODE=preview node server.mjs
```

## Chạy trên máy

Cần Node.js 22 trở lên. Chạy từ thư mục này. Không cần cài gói phụ thuộc.

```sh
node server.mjs
```

Mở [Đại Tín Research trên máy này](http://127.0.0.1:4310/). Máy chủ chỉ lắng nghe tại `127.0.0.1`. Dừng bằng Ctrl+C. Có thể đổi cổng qua biến `PORT`.

```sh
node --test test/research.test.mjs
```

## Thử ba luồng

1. Mở hồ sơ mặc định. Hồ sơ gia hạn nhận 30/06/2026, còn đang giải quyết tại 01/07/2026, đối chiếu 02/07/2026. Bấm **Điều 17 khoản 2** hoặc mốc tiếp nhận. Mở **Mẫu 02 của Thông tư 10**, trang PDF 4, dưới nhãn lịch sử.
2. Chọn **Nhận từ 01/07**. Mở **Mẫu 01 của Thông tư 20**, trang PDF 5. Mở lịch sử để thấy cả hai phiên bản. Chọn **Thiếu dữ kiện** để kiểm hệ thống hỏi tình trạng tại mốc trước khi đưa mẫu.
3. Tìm **Điều 110 khoản 3 điểm a Thông tư 10/2026**. Kết quả đưa điều khoản ban đầu và phần được sửa, có nhãn thời điểm. Chọn thủ tục **Sửa đổi văn bằng nhãn hiệu đã cấp** để đối chiếu Mẫu 03 cũ với Mẫu 02 thay thế. Chọn **Chủ động sửa đổi đơn nhãn hiệu đang xét** để thấy Mẫu 10 ở phụ lục khác.

Chế độ **Chuẩn bị nộp** sử dụng ngày dự kiến nộp. Chế độ **Đã tiếp nhận** tách ngày tiếp nhận khỏi ngày đối chiếu. Nhập ngày của đúng đơn hoặc yêu cầu đang tra. Ngày trong câu tìm kiếm được dùng như văn bản truy vấn. Việc xác định bản áp dụng dựa trên các trường ngày đã xác nhận trong biểu mẫu tra cứu.

| Thủ tục | 01/04 đến trước 01/07/2026 | Từ 01/07 trong phạm vi dữ liệu |
|---|---|---|
| Nộp đơn đăng ký nhãn hiệu | Mẫu 04, Phụ lục I, Thông tư 10 | Cùng mẫu |
| Gia hạn hiệu lực văn bằng | Mẫu 02, Phụ lục II, Thông tư 10 | Mẫu 01, Phụ lục II, Thông tư 20 |
| Sửa văn bằng đã cấp | Mẫu 03, Phụ lục II, Thông tư 10 | Mẫu 02, Phụ lục II, Thông tư 20 |
| Chủ động sửa đổi đơn đang xét | Mẫu 10, Phụ lục I, Thông tư 10 | Cùng mẫu |
| Sửa đổi theo thông báo thẩm định | Văn bản phản hồi theo Điều 83 khoản 2 điểm b | Cùng cách xử lý |

Với hồ sơ tiếp nhận trước mốc và còn đang giải quyết tại mốc, đối chiếu quy định tại ngày tiếp nhận. Bản cũ được gắn nhãn lịch sử. Tra cứu hồ sơ đã hoàn tất cũng được gắn nhãn chỉ đối chiếu lịch sử. Các kết quả hướng tới chọn đúng phiên bản biểu mẫu, cần luật sư hoặc người phụ trách đối chiếu các điều kiện nghiệp vụ cụ thể.

## Dữ liệu và kỹ thuật

- `corpus/vn-trademark.json` là bản dữ liệu có phiên bản, gồm 10 vị trí điều khoản, 6 bản mẫu và 4 tài liệu gốc. Tệp PDF nằm trong `corpus/snapshots`. Máy chủ kiểm SHA-256 khi khởi động. Mỗi nút mở đúng trang vật lý PDF, bên cạnh liên kết về nguồn chính thức.
- `research.mjs` dùng tìm kiếm từ khóa Việt/Anh, từ khóa không dấu, số điều, khoản, điểm và số hiệu. Việc chọn phiên bản chạy bằng quy tắc theo dữ kiện đã nhập. Ngày kết thúc là biên loại trừ. Khi thiếu tình trạng chuyển tiếp, ngày nằm ngoài phạm vi hoặc câu hỏi cần đánh giá chuyên môn, hệ thống giữ giới hạn tương ứng.
- `server.mjs` phục vụ UI, API và bản lưu PDF đã đăng ký trên máy cục bộ. Các phép kiểm bao gồm từ chối origin khác máy chủ, đường dẫn ngoài danh mục, dữ kiện sai và các mốc sát ngày chuyển tiếp.
- Thông tư 20, Điều 12 sửa Điều 110 và dẫn tới Mẫu 03 của Thông tư 10. Khoản 5 Điều 16 thay mẫu đó bằng Mẫu 02 của Thông tư 20. Kết quả sửa văn bằng từ 01/07 dẫn cả hai căn cứ. [Thông tư 20, Điều 12](https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/5/20-bkhcn.pdf#page=8), [Điều 16](https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/5/20-bkhcn.pdf#page=13), [Điều 17–18](https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/5/20-bkhcn.pdf#page=14), [Phụ lục Thông tư 20](https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/5/20-bkhcn-kem.pdf#page=8)
- Nguồn phiên bản trước và mẫu Phụ lục I. [Thông tư 10 trên Công báo](https://congbaocdn.chinhphu.vn/180507251028987904/2026/4/20/469297-1776676154_v1_1776676768_signed.pdf), [Phụ lục II Thông tư 10](https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/4/10-bkhcn-pl2.pdf)

## Trạng thái so với PRD

Đã triển khai lát cắt FR-01, FR-03, FR-04, FR-05 và FR-06 cho corpus công khai nêu trên, cùng tìm kiếm từ khóa và định vị văn bản của FR-02. Phạm vi này dùng máy chủ Node.js và kho nguồn có phiên bản, phù hợp kiểm quy tắc trước khi chọn hạ tầng tìm kiếm hoặc model. Bản SOT ứng viên bổ sung quy trình kiểm nguồn và cổng duyệt cục bộ. Phân quyền hồ sơ và SSO, lịch sử hồ sơ, Madrid, tìm kiếm ngữ nghĩa và nghiệm thu pháp lý độc lập thuộc các gói tiếp theo. Chưa có số đo so với quy trình hiện tại, LLM hoặc agent có công cụ. Bản cục bộ chưa dùng cho pilot 10 người hoặc dữ liệu khách hàng thật.
