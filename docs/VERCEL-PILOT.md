# Đại Tín: chuyển từ gói web sang pilot Vercel

Ngày giao việc 11/11/2026. Người dùng yêu cầu dọn nợ kỹ thuật, commit, push và deploy Vercel để CEO Bình dùng thử. Quyền này bao gồm đưa mã nguồn và bộ hồ sơ mô phỏng lên Vercel; quyết định trước đây không đưa lên Base44 vẫn được giữ. Không đưa khóa trên máy tác giả hoặc hồ sơ khách hàng thật lên bản thử.

## TIP: phạm vi và điều kiện đạt

Đích là một URL HTTPS có đăng nhập, tám hồ sơ mẫu, tra căn cứ/mẫu, mở lại hồ sơ qua phiên mới, sửa tay hoặc bằng AI thật, duyệt từng phần, tải đúng Word đã duyệt và giữ bản cũ. Không thay PRD, SOT hoặc mẫu Word bằng bộ dựng trang mới. Giữ nghiệp vụ đã kiểm và giao diện có logo thật.

Ba vấn đề hạ tầng đã quan sát: SQLite ghi cục bộ không tồn tại bền vững trên Vercel Function; session và hạn mức ở RAM không đồng nhất khi đổi instance; Poppler cài trên Mac không có sẵn trên Vercel. Kiến trúc pilot nhỏ nhất là adapter lưu snapshot SQLite cùng session/hạn mức vào Vercel Blob riêng tư có đọc nhất quán, điều kiện ETag và lease trước thao tác ghi. Function chỉ tạo bản SQLite tạm cho request, gửi thành công sau khi lưu snapshot. Không dùng thư mục tạm làm kho lâu dài. PDF chuyển provider PDF.js/canvas cho môi trường web, nhánh Poppler cục bộ được giữ.

Bất biến: chặn nhóm khác, chuyên viên không duyệt, tab cũ không ghi đè, không xuất đề xuất chưa duyệt, bản Word cũ giữ dấu kiểm, không lấy dữ kiện trong tệp làm lệnh hệ thống, không tự nâng SOT ứng viên thành nguồn được luật sư duyệt. Không lặp model khi lỗi lưu hoặc không rõ kết quả. Khóa và token chỉ ở cấu hình máy chủ; repo GitHub riêng tư.

Ngân sách pilot giới hạn số lượt AI theo tài khoản, số nguồn/ký tự và thời gian xử lý; không mua thêm gói hay tự nâng cấp dịch vụ. Chỉ dùng bộ hồ sơ mô phỏng. Mọi dữ kiện, tài liệu và phê duyệt dùng để kiểm nghiệm đều phải có nhãn mô phỏng. Nếu không cấu hình được AI thật, không thay bằng đầu ra giả hoặc báo hoàn tất AI.

Phép kiểm cần thiết: hồi quy core; PDF parser/render với tám fixture; đồng thời/ETag/khóa ghi; session, logout và hạn mức qua cold request; hỏng lưu không xác nhận thành công; Vercel thật gồm đăng nhập, hai phiên và tải Word; màn nhỏ và desktop. Dọn bản tạm sau kiểm. Commit toàn bộ thay đổi liên quan sau kiểm; push repo riêng tư và deploy bản commit đó. Báo URL, commit, kết quả và phần còn thiếu.

## Giới hạn kết luận

Đợt này chứng minh khả năng dùng qua URL và tính bền vững/phân quyền của lát cắt pilot, không chạy lại phép đo công lao động với agent trực tiếp. Nếu đổi model sang AI Gateway, kết quả cục bộ Qwen trước đây không xác nhận chất lượng model cloud. Chưa có luật sư Đại Tín thật duyệt SOT hoặc chấm đầu ra. Không dùng số test để tuyên bố sản phẩm đã sẵn sàng cho hồ sơ khách hàng thật.

## Verify

Kiểm tại máy tác giả: 73/73 kiểm tra tự động đạt; build tạo 21 PDF công khai theo SHA-256 ra CDN; dependency audit không có cảnh báo tại thời điểm kiểm. Kiểm thực với private Blob mới: ghi bằng ETag hiện tại thành công, ETag cũ bị từ chối và đọc nhất quán thấy bản mới. Phát hiện GET nén có ETag yếu và đã kiểm đối chiếu validator mạnh trước CAS; không bỏ tiền tố yếu rồi dùng làm ETag mạnh một cách mù quáng.

Rà soát phát hiện và sửa cổng duyệt thiếu nguồn, nhầm “mỹ phẩm” thành nước Mỹ, khác biệt body đã parse của Vercel và giới hạn 4,5 MiB khi trả PDF qua Function. Bộ PDF web được đối chiếu với tám fixture và nhánh Poppler, không đổi mẫu Word hoặc dữ liệu SOT.

Các gate trên URL triển khai (đăng nhập, cold session, AI thật, native PDF Linux, mở PDF lớn và Word hai phiên) chỉ được ghi đạt sau khi chạy thật. Biên bản bàn giao giữ riêng kết quả tại môi trường đó; không lấy các ca local thay cho gate cloud. Trần AI riêng của project đặt 1 USD không tự làm mới, không tự mua credits. Mô hình thử được quyền free-credit thực tế là google/gemini-2.5-flash-lite qua AI Gateway; không coi chất lượng của model đó đã được luật sư nghiệm thu.
