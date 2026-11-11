# M6: Bộ 30 yêu cầu đánh giá sáng chế

Bộ ca do assistant soạn ngày 11/11/2026; không phải yêu cầu khách hàng thật, không phải kết quả luật sư chấm mù và chưa chứng minh là tập kiểm chưa thấy. Cần luật sư xác nhận đầu vào, đáp án và độ khó trước khi dùng để quyết định chuyên môn. Không lấy các ca structural QA thay cho đánh giá này.

## Cách dùng

`requests.jsonl` chỉ chứa mã mù, yêu cầu, input cần chuẩn bị và phạm vi. Giữ `judge-key.jsonl` khỏi prompt/model và khỏi frontend. Một người chuẩn bị gói, người khác chấm đầu ra đã bỏ nhãn arm. Hoán đổi thứ tự arm giữa các ca. Khóa trước model/version, system constraints, nguồn cùng checksum, công cụ, context budget, max output, ngày kiểm và trần chi phí.

A: agent trực tiếp có tệp và công cụ. B: workspace với cùng model, nguồn, công cụ và giới hạn. Tách phép so giá trị workspace này khỏi phép so cấu hình tốt nhất với Astra/Fable. Model khác, nguồn khác hoặc công cụ khác chỉ cho kết luận giới hạn; thiếu quyền/API thì ghi chưa đo. Không gửi hồ sơ bí mật hoặc chưa công bố vào tìm kiếm công khai; chỉ dùng đầu vào mô phỏng hoặc được phép.

## Chuẩn bị nguồn

Gói hồ sơ phải chứa đúng phiên bản yêu cầu bảo hộ, bản mô tả ban đầu, D1/D2 toàn văn, thông báo thẩm định và luật áp dụng tại mốc. Chỉ định riêng claim publication/kind/language và claim số nào. Chia demo và held-out theo họ sáng chế, không theo file hoặc một đoạn khác cùng tài liệu. Không dùng hồ sơ mô phỏng làm bằng chứng nguồn bằng sáng chế thật. Nếu thiếu nguồn đối chiếu thì đáp án kỳ vọng là nhận ra thiếu dữ kiện.

Mỗi ca có `inputRequired` để người vận hành chuẩn bị; không tự bịa một patent number/ngày/điều luật để lấp. Source IDs cùng hashes thực tế phải lưu trong receipt khi chạy. Cần luật sư xác định ngày liên quan cho từng claim khi có nhiều quyền ưu tiên hoặc ngoại lệ.

## Chấm

Cổng bắt buộc: không lộ dữ liệu khác nhóm; không bịa nguồn/trang/yêu cầu bảo hộ; không xuất bản chưa duyệt như đã duyệt; không kết luận quyền hiện tại/FTO từ dữ liệu thiếu; không bỏ mất đơn vị, phủ định hoặc quan hệ phụ thuộc có ý nghĩa.

Điểm rubric cho mỗi ca, 0–2 mỗi chiều: hiểu yêu cầu, đủ chứng cứ, đúng phạm vi/thời điểm, lý luận chuyên môn, đầu ra dùng được. Luật sư chấm lý luận; code chỉ chấm các chỉ dấu cấu trúc. Một lỗi nghiêm trọng không được bù bằng tổng điểm cao.

Đo tổng thời gian từ giao việc đến đầu ra đạt chất lượng, thời gian người dùng can thiệp thực, lượt tìm/mở/chọn nguồn, lần sửa, lần quay lại bối cảnh, token/call/model elapsed, chi phí provider thực nếu có. Không suy ra phút công người từ click script. Lưu thất bại, sửa tay, retry và dispatch chưa rõ kết quả. Không lặp model tự động chỉ để có kết quả đẹp.

Giả thuyết giữ sản phẩm: trong phân khúc đã chọn, giảm >=25% trung vị thời gian can thiệp thực với chất lượng tương đương và không có lỗi cổng nghiêm trọng. Đây là mục tiêu đề xuất, chưa đo, không phải cam kết hiệu quả. Nếu không có lợi ích, phân tích nguyên nhân hoặc thu hẹp thành bộ nguồn/công cụ dùng trong agent.

Hai phiên bắt buộc cho ca tiếp tục hồ sơ: phiên 1 tạo/duyệt/export; đăng xuất và mở lại; phiên 2 có chỉ dẫn mới, xem tác động, sửa đúng phần, duyệt và export; bản đã duyệt cũ giữ checksum. Một lần chạy tự động chỉ chứng minh wiring và state, không chứng minh năng suất luật sư.
