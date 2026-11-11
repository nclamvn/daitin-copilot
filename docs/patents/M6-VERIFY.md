# M6: nghiệm thu kỹ thuật trước phát hành

Ngày 11/11/2026. Scope và quyền thực thi trong M6-TIP.md. Phiên bản ứng dụng 0.6.0. Đây là pilot với hồ sơ mô phỏng, không phải luật sư ký duyệt dataset hay kết luận hồ sơ khách hàng.

## Đầu ra đã có

Bộ nguồn ứng viên 43 nguồn, 1.874 đoạn có vị trí và dấu kiểm: 17 tài liệu sáng chế, 11 hướng dẫn, 8 văn bản pháp luật, 4 nguồn chính sách, 3 nguồn công ty/thứ cấp. 99 yêu cầu bảo hộ XML gốc, 37 yêu cầu OCR chưa duyệt; 24 khoảng thiếu được công khai. 35 nguồn mới và 8 snapshot tái dùng. Dữ liệu mới khoảng 31 MiB; không tự tải PATENTSCOPE bằng robot, mua API hoặc suy ra tình trạng quyền/họ sáng chế chưa có nguồn xác minh.

Dataset digest: 936ea8eb54041462acc665fc0ebf33c2d3865981d7749ec6b2df326a4edf86c7.

M6 có trang sáng chế mặc định, thư mục nguồn có bộ lọc/tìm song ngữ, bản nguồn lưu đúng SHA và nguồn gốc trực tuyến riêng, vai trò yêu cầu đang xét/D1, thông báo và chỉ dẫn riêng theo nhóm, ma trận và phản hồi AI/sửa tay, duyệt từng phần, lịch sử và Word từ bản duyệt bất biến. Đổi chỉ dẫn làm phần phản hồi cần duyệt lại; các phần không phụ thuộc giữ trạng thái. Luồng nhãn hiệu và mẫu Word cũ được giữ.

## Bằng chứng local

- Toàn bộ 101/101 kiểm tra đạt, không có ca lỗi hoặc bị bỏ qua; build đạt; kiểm tra dependency production không có cảnh báo tại thời điểm kiểm.
- Contractor độc lập đọc raw/extract/catalog, băm 43 bản gốc và 43 bản trích và đối chiếu 1.874 span, không gọi validator của Builder. Đúng hash/span không xác minh ngữ nghĩa.
- Data tests có rebuild offline byte-identical và các mutation về hash, span, vai trò, ngày, dependency. Cảnh báo OCR không bị nâng thành xác minh pháp lý.
- Qua API thật trên Node local: đăng nhập, tra cứu, ngày tương lai cần dữ kiện; trích giả/sai vai trò trả 422; tab cũ trả 409; editor duyệt trả 403; chưa duyệt chưa xuất Word; hai phiên đăng nhập cùng hồ sơ; thay chỉ dẫn giữ duyệt ma trận và bỏ duyệt phản hồi; Word 1 không đổi, Word 2 mới; nhóm khác không đọc/xuất hồ sơ; nguồn riêng không nằm trong global catalog. Nội dung sửa/duyệt local do script mô phỏng, AI bị tắt trong lượt local này.
- Browser thật đã đăng nhập và mở hồ sơ mẫu; kiểm desktop và 390 × 844, ngăn nguồn mobile hoạt động. Phát hiện biểu mẫu nhập liệu che hết mặt làm việc, đã thu gọn dữ kiện đã lưu. OCR có nhãn cảnh báo và nguồn gốc mở lại được.
- Word local được render bằng LibreOffice, kiểm cả 2 trang của bài đơn giản. Bài kiểm định dạng riêng với claim VN42110 qua hai trang nguồn đã render được bốn trang Word/PDF, giữ bản nguồn và chuyển ký tự phân trang thành ngắt dòng Word. Render còn bộc lộ nhiễu đầu trang trong OCR: đã đánh dấu claim này và chặn dùng trong production. Bản Word của bài kiểm định dạng không được coi là đầu ra nghiệp vụ dùng được. Render trên cloud thực tế cần kiểm sau triển khai.

## Lỗi thật phát hiện và sửa

1. OCR VN47032 trang PDF 18 đọc sai từ kỹ thuật và đổi glyph đơn vị. Giữ OCR gốc, ghi knownExtractionWarning, chặn dùng bản trích hỏng đã biết khi AI/phê duyệt; không tự sửa thành nguồn đã được luật sư xác nhận.
2. D1 từng có thể là claim khác của cùng công bố. Cổng mới chặn cùng source ID hoặc cùng publicationIdentifier tường minh; không tự suy luận quan hệ họ khi thiếu dữ liệu.
3. Claim VN42110 chứa form feed U+000C qua trang, từng tạo XML Word lỗi. Bộ xuất mới chuyển dấu phân trang thành ngắt dòng cấu trúc, ghi chú thay đổi trình bày, giữ nguyên dữ liệu đã lưu; ký tự XML không hợp lệ khác bị từ chối. Đồng thời claim có nhiễu đầu trang OCR được đánh dấu lỗi đã biết và không qua cổng AI/duyệt; test định dạng sử dụng bản sao kiểm thử riêng, không sửa dataset chuẩn. Kiểm tra xuất từ claim thật và parse toàn bộ XML/rels bằng ElementTree đạt.

4. Claim phụ thuộc từng thiếu nội dung claim cha trong prompt. Bản mới tự ghim các claim dẫn chiếu tường minh, tối đa 8 nguồn; chặn phân tích và duyệt khi còn thiếu hoặc quan hệ dẫn chiếu bất thường. Trích đoạn kế thừa gắn đúng claim nguồn, không tự suy luận quan hệ họ sáng chế.

## Gate cloud và giá trị

Chỉ đánh dấu đạt trên cloud sau lần triển khai thật: đăng nhập, AI thật, nguồn có hash, hai phiên, phân quyền, Word và giữ dữ liệu sau redeploy. Biên bản bàn giao ngoài repo ghi deployment ID, commit và kết quả thực tế, không lấy local thay cloud.

Bộ 30 yêu cầu do assistant soạn đã tách yêu cầu có mã mù và đáp án/rubric; chưa có luật sư xác nhận đáp án chuẩn và chấm mù và chưa phải tập kiểm chưa thấy độc lập. Ca OCR đã nhìn trong phát triển ghi là calibration, không gắn nhãn unseen.

Chưa đo công người thật hoặc so trọn quy trình với agent frontier. Lượt gọi model cùng prompt, cùng model (nếu chạy) chỉ kiểm adapter và khả năng trả cấu trúc, không chứng minh giảm 25% thời gian luật sư. Không có key/quyền model Astra/Fable qua API thì ghi chưa đo, không dùng Gemini thay rồi gọi là benchmark frontier.

## Sửa từ ca AI cloud thực tế

Lượt AI cloud đầu tiên đã bị chặn 422 vì model chép đoạn D1 không khớp nguyên văn. Không có đề xuất hoặc bản duyệt mới được lưu. Đã đổi hợp đồng: model chọn mã đoạn claim/D1, code lấy nguyên văn theo dấu kiểm và vị trí UTF-16 rồi chạy lại cổng kiểm trích dẫn. Không dùng đối sánh gần đúng hoặc bỏ cổng để có kết quả đạt. Biên nhận các lượt gọi sau được lưu riêng trong SQLite, có hash đầu vào/đầu ra, thời gian, token và lỗi, không có khóa hoặc nguyên văn dữ kiện riêng. Không tự gọi lại model. Cần chạy lại đúng ca trên cloud trước khi đánh dấu đạt.

## Disposition

READY cho kiểm thử kỹ thuật trong phạm vi đã nêu sau khi kiểm tra cloud đạt; NOT READY cho SOT pháp lý phát hành/hồ sơ khách hàng thật. Còn cần luật sư rà soát ngữ nghĩa/OCR/căn cứ áp dụng, bổ sung tình trạng quyền/họ sáng chế/tài liệu ngoài sáng chế theo quyền truy cập, tính đầy đủ theo lĩnh vực, vận hành backup/bảo mật/quy mô và phép đo giá trị thật.

Lưu ý bản Word: release đóng băng nội dung và nguồn, bộ xuất tái tạo theo mã mẫu. Kiểm bất biến trong đợt này áp dụng cùng phiên bản renderer. Khi đổi mẫu/bộ xuất, phải giữ renderer cũ hoặc lưu bản artifact đã duyệt; chưa chứng minh bất biến qua mọi thay đổi renderer trong tương lai.
