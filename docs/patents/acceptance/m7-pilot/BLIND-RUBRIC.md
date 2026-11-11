# Thang chấm mù pilot M7

Đơn vị chấm là một hồ sơ của một nhánh qua hai phiên. Có 8 hồ sơ và tối đa 16 bài chấm. Toàn bộ tài liệu mô phỏng, các đoạn nguồn được khóa trước khi chạy. Mỗi nhánh nhận cùng dữ kiện, trang, đoạn, chỉ dẫn và model. Chỉ đoạn đã chọn được phép làm căn cứ. Trang khác trong tệp D1 có thể hỗ trợ hoặc không hỗ trợ dấu hiệu đang xét, vì vậy không được dùng để cứu một kết luận vượt nguồn.

Người chấm chỉ nhận mã mù, bản ma trận và phản hồi ở định dạng chung, nguồn được chọn theo vai trò, chỉ dẫn của hai phiên và đáp án riêng theo mã hồ sơ. Tách tên nhánh, log kỹ thuật, Word có nhận diện sản phẩm và thời gian khỏi gói chấm. Xáo thứ tự hai nhánh. Khoá điểm trước khi mở khóa ánh xạ. Nếu người chấm nhận ra nhánh từ câu chữ, ghi khả năng mất mù. Lượt chấm mô phỏng phải ghi rõ loại người chấm.

| Tiêu chí | 2 điểm | 1 điểm | 0 điểm |
| --- | --- | --- | --- |
| Trung thực nguồn | Dẫn đúng đoạn, vai trò và định vị. Giữ số liệu, đơn vị, điều kiện và phủ định. | Đúng dữ kiện, thiếu một liên kết hoặc định vị phụ. | Dẫn sai căn cứ, làm sai nghĩa hoặc không có đối chiếu kiểm được. |
| Nhận định kỹ thuật | Nêu đúng quan hệ hỗ trợ, khác biệt hoặc chưa đủ căn cứ với từng dấu hiệu quan trọng. Phân biệt suy ra với trích dẫn. | Hướng chính đúng, thiếu một phần hoặc quá dè dặt ở điểm đã rõ. | Nhận định ngược, bỏ dấu hiệu cốt lõi hoặc xem suy đoán là dữ kiện. |
| Giới hạn đoạn D1 | Mọi mệnh đề quan trọng chỉ nói về đoạn được chọn. Mức chắc chắn phù hợp với bằng chứng. | Có một câu mơ hồ về phạm vi, nhưng không có khẳng định vượt nguồn rõ ràng. | Khẳng định về toàn D1, trang không chọn hoặc kết luận pháp lý không có căn cứ. |
| Phản hồi phiên 1 | Ngắn, nhất quán với ma trận, nêu căn cứ và việc cần làm tiếp phù hợp. | Dùng được sau sửa nhẹ, hoặc thiếu bước tiếp theo cụ thể. | Mâu thuẫn ma trận, không trả lời thông báo hoặc không thể rà từ nguồn. |
| Tiếp tục phiên 2 | Đáp ứng đúng yêu cầu mới, giữ dữ kiện và phạm vi. Ma trận và bản 1 được giữ theo biên nhận. | Có cập nhật đúng hướng nhưng thiếu một nội dung hoặc chưa đủ chứng cứ giữ phiên bản. | Bỏ cập nhật, tự thay ma trận, làm mất bản 1 hoặc lặp một lỗi nghiêm trọng. |

Tổng 0–10. Ngưỡng đạt mỗi hồ sơ là ít nhất 8 điểm, đủ hai phiên và không có lỗi nghiêm trọng. Lưu nguyên điểm thô của bài có lỗi nghiêm trọng, song ghi không đạt. Bài vắng đầu ra ở một phiên ghi `incomplete`, cho 0 điểm toàn ca khi tính tỷ lệ hoàn thành và số đo theo ý định thử nghiệm. Không loại ca thất bại khỏi mẫu 8. Có thể báo riêng thống kê ở các cặp đủ hai phiên kèm cỡ mẫu.

Các lỗi nghiêm trọng được khóa trước:

- `D1_SCOPE` — khẳng định rõ ràng D1 có, không có hoặc loại trừ một dấu hiệu trên toàn tài liệu khi chỉ có đoạn đã chọn. Một câu như “D1 không đề cập dấu hiệu” thiếu giới hạn là lỗi, kể cả nếu một câu khác nói chung rằng đang kiểm đoạn. “Đoạn D1 đã chọn chưa cho thấy dấu hiệu” đúng phạm vi.
- `SOURCE_INTEGRITY` — dẫn sai trang hoặc vai trò, trích bịa, viện dẫn trang chưa chọn, đổi số, đơn vị, phủ định hoặc điều kiện làm thay đổi nghĩa trọng yếu.
- `UNSUPPORTED_TECHNICAL` — khẳng định dấu hiệu đã được công bố khi đoạn chỉ liên quan một phần hoặc mâu thuẫn. Suy luận minh bạch như 16 bit bằng 2 byte được phép.
- `LEGAL_CONCLUSION` — tự kết luận về tính mới, trình độ sáng tạo, hiệu lực, xâm phạm hoặc FTO từ dữ liệu mô phỏng.
- `VERSION` — ma trận đã duyệt bị sửa ở phiên hai, bản 1 thay byte hoặc bản chưa duyệt được phát hành như bản đã duyệt.

Quy tắc tránh chấm thiên lệch. Cụm “D1” có thể đứng như tên nguồn sau khi chủ ngữ đã được giới hạn rõ, ví dụ “Trong đoạn D1 được chọn, rơ le tác động sau 4 giây”. Không tự cộng điểm vì nhắc giới hạn nhiều lần. Với phép so sánh xác định, mô tả khác biệt chính xác đáng điểm hơn từ chối chung chung. Trong phiên 2, “cần kiểm bản gốc” là việc tiếp theo hợp lệ, còn “đã kiểm” cần bằng chứng từ gói nguồn.

## Báo cáo công thao tác

Tách số thao tác có ý nghĩa do kịch bản thực hiện, thời gian máy qua từng phiên và thời gian chủ động của luật sư. Chỉ đếm hành động ở cấp người dùng hoặc người vận hành như mở hồ sơ, chọn đoạn, yêu cầu sinh, sửa, duyệt, xuất. Đếm riêng API, model và tool call. Không dùng thời gian chờ máy hoặc số lần gọi API để suy ra công luật sư. Ghi thao tác độc nhất của mỗi nhánh, điều kiện tự động hóa, lỗi và số lượt thử. Nếu chưa có người dùng đo, để thời gian chủ động là chưa đo.
