# Đại Tín IP Workbench

Milestone M1 đặt nguồn thật và phiếu rà soát vào cùng bàn làm việc. Một luật sư hoặc chuyên viên có thể tra số đơn công khai, mở căn cứ, kiểm danh mục Nice, chạy checklist theo dữ kiện và xuất phiếu kèm nguồn để rà. Bản hiện tại là ứng viên cục bộ cho nhãn hiệu quốc gia Việt Nam.

[Mở bàn làm việc trên máy này](http://127.0.0.1:4312/copilot/)

## Thử một lượt

1. Trong **Đơn chuyển công bố**, tìm `4-2026-11740`. Kết quả dẫn dòng 6 của bảng Cục Sở hữu trí tuệ. Đính kèm dòng bằng nút **Thêm vào phiếu**. Dữ kiện này là sự kiện chuyển công bố, độc lập với việc xác định trạng thái hiện tại.
2. Trong **Phân nhóm Nice**, tìm `cà phê` hoặc `090001`. Xem mã, nhóm, thuật ngữ tiếng Việt và trang PDF. Đính kèm mục cần rà. Khi chọn 2027, bàn làm việc hiển thị dữ liệu WIPO để so sánh phiên bản.
3. Trong **Tìm văn bản**, tìm `Điều khoản chuyển tiếp` và chọn **Luật 131/2025/QH15 · bản Công báo có lớp chữ**. Mở trang PDF 24, nơi bắt đầu Điều 3. Có thể đính kèm trang như căn cứ tham chiếu.
4. Xóa các tham chiếu vừa thử để bắt đầu một hồ sơ riêng. Trong **Rà hồ sơ**, tạo một tình huống giả lập. Ví dụ chọn gia hạn, chế độ đã tiếp nhận, nhận 30/06/2026, đối chiếu 01/07/2026 và chọn đang giải quyết. Kiểm Mẫu 02 lịch sử, khoản 3 Điều 109, Điều 17–18 Thông tư 20 và các mục ủy quyền có điều kiện. Nếu để trạng thái chưa xác định, ứng dụng dừng cả chọn mẫu và checklist.
5. Bấm **Lưu phiếu** để xuất Markdown gồm dữ kiện, kết quả, nguồn, danh mục đã đính kèm và chỗ ghi ý kiến luật sư. Xóa danh sách đính kèm trước khi chuyển sang hồ sơ khác. Phiếu và danh sách trên màn hình thuộc phiên trình duyệt hiện tại.

## Dữ liệu và quyền sử dụng

| Lớp | Dữ liệu đã thu | Dấu vết |
|---|---|---|
| Quy phạm và mẫu | Luật sửa đổi, nghị định, thông tư, bản hợp nhất, mẫu và hướng dẫn. Một số bản scan chỉ phục vụ mở trực tiếp | Cơ quan, loại nguồn, SHA-256, trang PDF vật lý |
| Sự kiện công bố | Bảng nhãn hiệu quốc gia của Cục đến tuần 44, chỉ gồm số đơn, hai ngày và kỳ đăng tải | Tệp XLSX, tên sheet, số dòng, ngày chụp |
| Phân loại Việt Nam | Nice 13-2026 tiếng Việt từ Công báo SHCN, nối mã cơ bản theo nhóm với WIPO | Mã, nhóm, trang và hàng trích PDF |
| Phân loại đối chiếu | WIPO Nice 13-2026 và 13-2027, tiếng Anh và Pháp | ZIP, tệp XML, khóa WIPO, mã cơ bản và phiên bản |
| Checklist | 22 mục có đoạn đối chiếu, tách phiên bản trước và từ 01/07 | ID, điều khoản, điều kiện, trang PDF, digest SOT cha |

Bảng công bố không chứa tên người nộp hoặc địa chỉ trong bốn cột được nhập. 395 dòng nằm trong danh sách rà riêng, gồm 393 dòng có năm trong số đơn khác năm của ngày nộp và 2 dòng khác cấu trúc dự kiến. Mỗi dòng vẫn truy về tệp gốc. Nếu một số đơn có nhiều dòng hợp lệ, kết quả hiển thị từng dòng. Bảng có phạm vi đến ngày chuyển công bố 30/10/2026. Phạm vi SOT pháp luật đối chiếu đến 10/11/2026. [Danh sách chuyển công bố của Cục](https://ipvietnam.gov.vn/phat-trien-chi-dan-ia-ly?_101_struts_action=%2Fasset_publisher%2Fview_content&_101_type=content&_101_urlTitle=danh-sach-on-ang-ky-so-huu-cong-nghiep-uoc-chuyen-cong-bo-uoc-coi-la-hop-le-nam-2026&p_p_id=101&p_p_lifecycle=0&p_p_mode=view&p_p_state=maximized)

Dữ liệu WIPO tiếng Anh và Pháp có ghi công **© WIPO**. Quyền tái sử dụng bên ngoài cần rà theo từng nguồn. WIPO có khu vực tải dữ liệu Nice, còn Global Brand Database có điều khoản cấm truy vấn tự động và thu gom hàng loạt. M1 dùng tệp phân loại tải chính thức và danh sách sự kiện do Cục phát hành. [Nice 13-2026 tiếng Việt](https://www.ipvietnam.gov.vn/documents/20195/1811572/NICE%2B2026%2Bfinal.pdf/15ecdeaa-3444-4674-9fc2-28ca2b8ec3d7), [Điều kiện sử dụng Nice](https://www.wipo.int/en/web/classification-nice/faq), [Điều khoản Global Brand Database](https://www.wipo.int/en/web/global-brand-database/terms_and_conditions)

Các bộ nguồn phí được giữ để nghiên cứu. Kết quả tiền phụ thuộc mã khoản thu, kênh thực hiện và giai đoạn áp dụng. M1 mở văn bản để đối chiếu và chưa tính phí hoặc ngày hạn cho hồ sơ. [Thông tư 29/2026/TT-BTC](https://congbao.chinhphu.vn/van-ban/thong-tu-so-29-2026-tt-btc-469232.htm), [Thông báo triển khai của Cục](https://www.ipvietnam.gov.vn/en/danh-sach-cac-on-ang-ky-nhan-hieu-tap-the-a-cong-bo1?_101_struts_action=%2Fasset_publisher%2Fview_content&_101_type=content&_101_urlTitle=thong-bao-ve-viec-trien-khai-thuc-hien-thong-tu-so-29-2026-tt-btc&p_p_id=101&p_p_lifecycle=0&p_p_mode=view&p_p_state=maximized)

## Chạy và tái dựng

Chạy lệnh từ thư mục `dai-tin-mvp`. Giao diện cần Node.js 22.13 trở lên có SQLite FTS5. Cấu hình đã thử trên Node.js 24.14.1. Tái dựng cần Python 3.10+, Poppler và hai thư viện trong `copilot/requirements.txt`. Chỉ mục phát hành cục bộ đã dựng sẵn.

```sh
PORT=4312 DAI_TIN_CORPUS_MODE=preview DAI_TIN_COPILOT=1 node server.mjs
python3 copilot/audit.py status
python3 copilot/build.py
node --test test/*.test.mjs
```

`sources.json` chốt các tệp gốc và quyền sử dụng nội bộ. `workflows.json` giữ mục rà, điểm dẫn và điều kiện. `evidence.sqlite` phục vụ tìm kiếm và xuất phiếu. `evidence.receipt.json` gắn dấu kiểm chỉ mục với dấu kiểm đầu vào và mã SOT cha. Khi khởi động, ứng dụng kiểm lại dấu kiểm chỉ mục và mọi bản nguồn. Không thể mở M1 ở chế độ SOT đã duyệt.

Đối chiếu URL chủ động bằng `python3 copilot/audit.py probe tm-events nice-vn26 nice-26`. Tệp đổi được chuyển vào `incoming` và chỉ mục đang dùng vẫn gắn với bản đã chụp. Rà riêng trang danh mục của Cục để phát hiện tên tệp XLSX tuần mới và trang master WIPO để phát hiện sửa dữ liệu. Khi tiếp nhận bản mới, ghi lại URL, SHA-256 và quyền, đối chiếu các dòng hoặc mã đổi rồi mới dựng lại và chạy kiểm thử. Nhật ký nguồn là `source-log.jsonl`.

## Giới hạn vận hành

Môi trường này chỉ chạy trên máy cục bộ. Dữ kiện đang thao tác không được lưu thành hồ sơ máy chủ. Phiếu xuất theo yêu cầu của người dùng. Các trang văn bản tìm được là nguồn tham chiếu. Kết luận hiệu lực và chọn mẫu của bàn làm việc dùng bộ quy tắc SOT có phạm vi riêng. Đưa vào sử dụng nghiệp vụ cần duyệt bản dữ liệu, xét quyền nguồn, phân quyền hồ sơ, nhật ký thao tác và thử với luật sư trên bộ hồ sơ đủ điều kiện.

## Bằng chứng kiểm thử lần này

Bản chỉ mục dựng lại khớp từng byte với bản đang chạy. Dấu kiểm của 26 tệp được kiểm khi nạp. Năm URL nguồn trọng yếu được tải lại và khớp bản lưu. Bộ kiểm tự động gồm 34 kiểm tra cho SOT và bàn làm việc. Phiếu 11 ca vẫn cần luật sư nghiệm thu. [Nhật ký tải lại nguồn](source-log.jsonl)

## Điều phối yêu cầu EN và VI

Tab **Điều phối EN/VI** nhận nội dung giả lập hoặc đã ẩn danh và JSON từ LLM. Bấm **Tạo gói cho LLM** để lấy hợp đồng quyết định, sau đó dán kết quả và bấm **Kiểm và thực thi**. Công cụ chạy cục bộ gồm lập phiếu theo SOT, tra Nice và tra sự kiện chuyển công bố. Lượt thử hiện dùng bước chuyển JSON thủ công. Dữ kiện và kết quả trình bày trong phiên trình duyệt, tệp phiếu chỉ tạo khi người dùng chọn lưu.

Từ thư mục `dai-tin-mvp`, chạy `node copilot/evals/run.mjs` khi máy chủ 4312 đang hoạt động để tái hiện 10 quyết định của Codex. Đây là phép thử tích hợp trên dữ kiện mô phỏng, có dấu vết tách quyết định mô hình khỏi kết quả sau cổng. [Kết quả đã chạy](evals/last-run.json)

## M2 với mô hình tự động trên máy

Cấu hình M2 dùng Qwen3-4B-Instruct-2507 bản lượng tử Q4_K_M với llama.cpp b12230. Mô hình chỉ nhận yêu cầu đã ẩn danh hoặc mô phỏng. Hai tiến trình chỉ lắng nghe tại 127.0.0.1. Cổng mô hình có khóa riêng. Khâu chọn hướng và công cụ gọi mô hình thật. Mã chuẩn hóa ngày và kiểm mốc, dữ kiện, quyền công cụ trước khi chạy nghiệp vụ. Mô hình và ứng dụng không gọi API ngoài khi xử lý. Nhật ký lưu dấu vân tay yêu cầu, mã lượt, quyết định và công cụ. Người dùng cần quản lý quyền đọc nhật ký và quyết định chính sách lưu giữ trước pilot.

Từ thư mục `dai-tin-mvp`, trên macOS Apple Silicon.

```sh
./copilot/setup-m2.sh
./copilot/start-m2.sh
```

Mô hình cần tải một lần khoảng 2,50 GB. Lệnh thiết lập giữ các tệp trong `work/daitin-m2-runtime` và kiểm SHA-256. Có thể đặt `DAI_TIN_RUNTIME_DIR` nếu chuyển thư mục. Khi đã mở, vào [bàn làm việc](http://127.0.0.1:4312/copilot/), chọn **Điều phối EN/VI**, nhập một ca mô phỏng và bấm **LLM tự điều phối**. Phần kiểm JSON thủ công vẫn có trong mục mở rộng để tái kiểm quyết định đã có.

Báo cáo 30 ca được khóa trước, quyết định đầu vào, kết quả sau cổng, mốc, phiếu và đối chứng cùng mô hình. [Báo cáo nghiệm thu máy](evals/m2/benchmark-report.json), [Bộ 30 ca khóa trước](evals/m2/blind-cases.json)

## Pilot chấm mù

Bật `DAI_TIN_PILOT=1 ./copilot/start-m2.sh` để yêu cầu xác nhận ẩn danh trước lượt điều phối. H17–H18 có kiểm hồi quy cho lý do và nội dung câu hỏi. Quy trình thu, xáo trộn, ghép điểm và bộ phiếu ngoại tuyến nằm trong [gói pilot](../../dai-tin-pilot/README.md).
