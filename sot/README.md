# Đại Tín Research · SOT nhãn hiệu Việt Nam

**Trạng thái** Ứng viên v0.1.1 dành cho rà soát trên máy cục bộ. Phạm vi là nhãn hiệu theo thể thức quốc gia tại Việt Nam, từ 01/04/2026 đến 10/11/2026. Bản ứng viên bao gồm 7 PDF chính thức, 23 vị trí điều khoản hoặc hướng dẫn, 6 phiên bản mẫu, 7 đối chiếu bổ sung và 11 ca kiểm nghiệp vụ được soạn cho lần triển khai này.

[Mở bản thử Đại Tín](http://127.0.0.1:4311/)

Bản v0.1.1 sửa dẫn chiếu Mẫu 02 gia hạn cũ thành **điểm a khoản 3 Điều 109**, tại trang PDF 131 Thông tư 10. Phiếu nghiệm thu mới gắn với mã SHA-256 của v0.1.1. [Trang PDF gốc](https://congbaocdn.chinhphu.vn/180507251028987904/2026/4/20/469297-1776676154_v1_1776676768_signed.pdf#page=131)

## Phạm vi dữ liệu

| Nhánh tra cứu | Dữ liệu quyết định | Dữ liệu đọc thêm |
|---|---|---|
| Nộp đơn quốc gia | Mẫu 04, Phụ lục I Thông tư 10, trang PDF 177 | Điều 69 về hình thức, Điều 100 về thành phần, Thông báo 4863 về ngày nộp |
| Gia hạn văn bằng | Mẫu 02 Thông tư 10, trang 4, hoặc Mẫu 01 Thông tư 20, trang 5 | Điều 93, 94 của Luật và khoản 3 Điều 108 về phạm vi gia hạn |
| Sửa văn bằng đã cấp | Mẫu 03 Thông tư 10, trang 7, hoặc Mẫu 02 Thông tư 20, trang 8 | Điều 97 của Luật và chuỗi đối chiếu văn bản thay mẫu |
| Chủ động sửa đơn đang xét | Mẫu 10, Phụ lục I Thông tư 10, trang 198 | Điều 115 của Luật và hướng dẫn về văn bản ủy quyền |
| Sửa đơn theo thông báo thẩm định | Văn bản phản hồi theo Điều 83 khoản 2 điểm b, trang 102 | Đọc cùng thông báo cụ thể của hồ sơ |

Khi tra hồ sơ nhận trước 01/07/2026 và còn đang giải quyết tại mốc này, dữ liệu chọn phiên bản tại ngày tiếp nhận. Hồ sơ đã giải quyết trước mốc cho phép xem lại phiên bản lịch sử. Khi thiếu thông tin về tình trạng tại mốc, ứng dụng yêu cầu xác nhận rồi mới chọn mẫu. [Điều 17 khoản 2 và Điều 18 khoản 2 Thông tư 20](https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/5/20-bkhcn.pdf#page=14)

Với sửa văn bằng từ 01/07, Điều 110 trong bản hợp nhất vẫn dẫn số 03 của mẫu cũ. Khoản 5 Điều 16 quy định thay đúng mẫu đó bằng Mẫu 02 ban hành kèm Thông tư 20. Khoản 8 bãi bỏ Mẫu 02 gia hạn cũ của Thông tư 10. Vì vậy, khóa định danh mẫu gồm văn bản, phụ lục và số mẫu. [Điều 110 bản hợp nhất](https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/7/06-vbhn-bkhcn.signed.pdf#page=119), [Khoản 5 và 8 Điều 16](https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/5/20-bkhcn.pdf#page=13), [Mẫu thay thế](https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/5/20-bkhcn-kem.pdf#page=8)

Hồ sơ trước 01/04 có thể mở căn cứ về chuyển tiếp và ngoại lệ. Chọn mẫu cho các hồ sơ này cần đợt dữ liệu lịch sử riêng. Phạm vi v0.1 cũng loại trừ tính hạn hoặc phí theo hồ sơ, tra cứu tình trạng đơn, tra cứu đăng bạ, các tuyến quốc tế và tài liệu nội bộ. [Điều 138–139 Thông tư 10](https://congbaocdn.chinhphu.vn/180507251028987904/2026/4/20/469297-1776676154_v1_1776676768_signed.pdf#page=161), [Điều 3 Luật 131 trong bản hợp nhất](https://congbaocdn.chinhphu.vn/180507251028987904/2026/10/6/470657-1791273236_v1_1791273883_signed.pdf#page=139), [Thông báo 4863 của Cục Sở hữu trí tuệ](https://ipvietnam.gov.vn/web/guest/thong-bao/-/asset_publisher/bHEp9KzHjHwY/content/thong-bao-ve-viec-ap-dung-quy-inh-cua-luat-so-131-2025-qh15-va-thong-tu-so-10-2026-tt-bkhcn-trong-qua-trinh-xu-ly-on)

## Cấu trúc và cách kiểm

| Vị trí | Vai trò |
|---|---|
| `../corpus/snapshots/` | Bản gốc lưu cục bộ, kiểm SHA-256 và số trang |
| `source_canonical/inputs.json` | Danh mục nguồn, điều khoản, phiên bản mẫu, khoảng áp dụng, từ khóa, điểm dẫn chứng, bảng phạm vi và bộ ca |
| `candidate.json` | Bản ứng viên dựng từ đầu vào có mã SHA-256 và bằng chứng kiểm từng vị trí. MVP nạp đúng bản này khi chạy thử |
| `verify-log.jsonl` | Nhật ký nối thêm về tái dựng, đối chiếu nguồn và quyết định phát hành |
| `incoming/` | Bản nguồn mới được lưu theo dấu kiểm khi cổng chính thức trả về nội dung khác |
| `approval.json` và `published.json` | Quyết định duyệt của Đại Tín và bản đã phát hành, chỉ phát sinh sau khi hoàn tất rà soát |

Văn bản ban hành và phụ lục xác lập biểu mẫu. Bản hợp nhất dùng để tra và đối chiếu. Thông báo của Cục được ghi là hướng dẫn nghiệp vụ. Đoạn trích và số mẫu được kiểm ở trang PDF vật lý. Hai mẫu cũ dạng ảnh dùng nhận dạng chữ để kiểm tên và số. Người rà soát mở chính bản scan để xác nhận. Mã SHA-256 kiểm tính toàn vẹn so với nội dung đã lưu. Việc xác thực danh tính người duyệt dựa trên quyền quản lý tệp cục bộ và quy trình của Đại Tín.

Chạy các lệnh dưới đây từ thư mục `dai-tin-mvp`. Chạy giao diện cần Node.js 22 trở lên. Tái dựng cần `pdfinfo`, `pdftotext`, `pdftoppm` và `tesseract`. Bản này đã kiểm bằng Poppler 26.07.0 và Tesseract 5.5.4. Phiên bản nhận dạng chữ khác có thể tạo dấu kiểm văn bản trang khác và cần đối chiếu lại.

```sh
node sot/cli.mjs build
node sot/cli.mjs check
node sot/cli.mjs status
node --test test/*.test.mjs
PORT=4311 DAI_TIN_CORPUS_MODE=preview node server.mjs
```

Trong ô tìm kiếm, thử **Điều 93 khoản 6 Luật Sở hữu trí tuệ**, **Điều 108 khoản 3 06/VBHN-BKHCN** hoặc **Thông báo 4863**. Ở luồng sửa văn bằng, đổi ngày dự kiến nộp từ 30/06 sang 01/07 để xem nguồn mẫu chuyển từ Phụ lục II Thông tư 10 trang 7 sang phụ lục Thông tư 20 trang 8.

## Cập nhật và duyệt

1. Rà danh mục công bố chính thức theo phạm vi, mốc hiệu lực và điều khoản chuyển tiếp. Việc tải lại URL đã biết kiểm nội dung tại URL đó. Văn bản mới cần được phát hiện qua danh mục công bố. [Cổng văn bản Chính phủ](https://vanban.chinhphu.vn/), [Công báo](https://congbao.chinhphu.vn/), [Thông báo Cục Sở hữu trí tuệ](https://ipvietnam.gov.vn/web/guest/thong-bao)
2. Chạy `node sot/cli.mjs probe <id-nguồn>` với ID trong danh mục. Lệnh dùng `curl` qua HTTPS. Nếu tệp đổi, so sánh bản mới ở `incoming/` với bản đã lưu và ghi nhận các điều, mẫu, ngày, ngoại lệ bị ảnh hưởng. Chỉ đưa bản mới vào đầu vào sau khi xác định đúng nguồn và quan hệ phiên bản.
3. Tái dựng và chạy `check`. Luật sư mở đúng trang gốc, đọc cùng điều khoản liền kề và xác nhận 11 ca trong `reviewCases`. Hai mốc 01/04 và 01/07, hai mẫu số 02 khác văn bản và việc phân biệt chủ động sửa đơn với phản hồi thẩm định là các điểm cần kiểm thủ công.
4. Chủ dữ liệu và luật sư ghi quyết định vào `sot/approval.json`. Các trường bắt buộc gồm `decision` là `approved`, `digest` của bản ứng viên, `scope` là `vn-national-trademark`, `approvedOn` dạng ngày ISO, `owner` và `reviewer` gồm `name` và `role`, cùng `reviewedCases` chứa ID các ca đã xác nhận. Hai vai trò lần lượt là **Chủ dữ liệu Đại Tín** và **Luật sư SHTT Đại Tín**, do hai người đảm nhiệm. Thay nội dung tạo mã mới và yêu cầu duyệt lại.
5. Chạy `node sot/cli.mjs publish`. Cổng kiểm quyết định duyệt, tái dựng, chạy lại 11 ca và yêu cầu đủ đối chiếu URL cho các PDF kể từ ngày chốt dữ liệu. Chế độ `DAI_TIN_CORPUS_MODE=published` chỉ nạp bản đã duyệt. Luồng hiện tại dành cho rà soát cục bộ. Quyền đưa kho dữ liệu ra ngoài nhóm và tích hợp hồ sơ khách hàng cần được Đại Tín xác định riêng.

Bộ kiểm này chứng minh kết quả trên các ca đã khai báo và khả năng chặn các lỗi dữ liệu được đưa vào thử. Rà soát pháp lý độc lập, kiểm trên hồ sơ chưa thấy và so sánh hiệu quả với người dùng LLM trực tiếp hoặc agent có công cụ là các bước đánh giá tiếp theo nếu mở chức năng chatbot.
