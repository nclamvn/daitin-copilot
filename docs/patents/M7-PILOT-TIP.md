# M7 · Kiểm soát phạm vi D1 và pilot tám hồ sơ

Mốc kế tiếp của M7 trên web Đại Tín. Dữ liệu là tám hồ sơ tự tạo, mỗi hồ sơ có yêu cầu bảo hộ, D1 và thông báo PDF. Luật sư có thể dùng gói này để diễn tập; cổng sử dụng hồ sơ khách hàng vẫn cần bằng chứng riêng.

## Sửa lỗi đã thấy

Trong hồ sơ M7 ban đầu, model đã lấy đúng đoạn D1 nhưng dùng chủ ngữ “D1” cho nhận định về phần thiếu, dễ bị hiểu là đã đọc hết tài liệu. Quy tắc máy chủ áp dụng cho nhận định và phản hồi mới. Khi quy được câu về đoạn đã chọn một cách an toàn thì ghi rõ phạm vi; khi câu tự nhận kiểm toàn tài liệu hoặc không thể giới hạn an toàn thì từ chối đề xuất và giữ hồ sơ. Duy trì nguyên văn trích dẫn, vai trò nguồn và Word đã phát hành. Giữ xác nhận luật sư trước khi duyệt. Ca P03 phát hiện cổng cũ đánh đồng câu giống hệt với cùng nguồn. So định danh nguồn, dấu kiểm bản gốc và mã công bố khi có, đồng thời giữ cổng chống tự đối chiếu cho claim nhập tay.

## Thiết kế pilot

| Thành phần | Cách thực hiện |
| --- | --- |
| Tám ca | Tám tình huống kỹ thuật khác mẫu mã vạch M7. Ghim cùng tệp, trang vật lý và đoạn cho hai nhánh. Có trường hợp đoạn đã chọn thiếu đặc điểm, trang ngoài phạm vi có dữ kiện đánh lạc hướng, đoạn khớp hoặc khác điều kiện/giá trị. |
| Phiên 1 | Nạp nguồn, lập ma trận và phản hồi, rà theo kịch bản, lưu Word bản 1. |
| Phiên 2 | Đóng phiên cũ, mở lại từ dữ kiện và bản xuất đã lưu, nhận chỉ dẫn mới, sửa riêng phản hồi, lưu Word bản 2. So dấu kiểm bản 1 trước và sau. |
| Workspace | Vercel production, PDF.js hiện hành, API/đăng nhập thông thường, dùng quyền editor và reviewer đang có. |
| Agent trực tiếp | Cùng model Gemini hiện hành và cùng gói nguồn, công cụ đọc hồ sơ đã lưu và xuất Word. Lưu tệp cục bộ qua hai phiên. Ghi riêng lời gọi công cụ của model, chênh lệch HTTP/máy khách và những cổng do ứng dụng cung cấp. |
| Chấm mù | Chốt trước đáp án và rubric. Chuẩn hóa thành phiếu cùng định dạng, mã ngẫu nhiên, loại nhãn nhánh/tên renderer/timing. Người chấm mô phỏng được cung cấp nguồn và chỉ dẫn nhưng không có bảng giải mã. Khóa điểm rồi mới mở bảng giải mã. |
| Công thao tác | Đếm bước quan sát được theo phân loại công việc và ghi thời gian chạy máy. Chấm độc lập chất lượng trước khi so bước. Giữ riêng số request, lượt tool, thời gian chờ và thao tác mô phỏng. Thời gian chủ động của luật sư để trống. |

Giữ nguyên Gateway và trần 1 USD đã có. Ngân sách thử tối đa 48 lời gọi, gồm 32 lượt soạn và tối đa 16 lượt chọn công cụ của agent. Chạy một lượt cho mỗi pha, không lặp lời gọi có kết quả chưa rõ. Sau tám phản hồi HTTP 429 rõ ràng trong nhánh agent, giữ nguyên tám lượt lỗi và chờ hạ tải, rồi cho phép gửi lại một lần mỗi lượt bị 429. Trần lần gửi HTTP sau điều chỉnh là 56, trần 48 giai đoạn model và 1 USD không đổi. Tách phép chấm theo rubric khỏi mọi lời gọi Gateway của ứng dụng. Chỉ thử lại thao tác ghi nếu kiểm được thao tác chưa được áp dụng và không gọi lại model. Giữ ca thất bại trong mẫu số.

## Cổng nghiệm thu

1. Tái hiện và kiểm bản sửa trên ma trận, phản hồi và cập nhật phản hồi riêng. Mở lại Word M7 cũ đúng dấu kiểm.
2. Chạy tám ca ở hai nhánh qua hai phiên. Lưu đủ dấu kiểm nguồn, dấu kiểm Word, biên nhận model và lỗi. Kiểm quyền và giới hạn kho như luồng thật.
3. Chấm mù đủ ca có kết quả và ghi ca chưa hoàn tất. Đếm riêng lỗi vượt phạm vi D1, sai số/đơn vị/phủ định, sai nguồn và việc không đáp ứng chỉ dẫn phiên hai.
4. Báo chênh lệch điểm và bước thao tác theo cặp cùng ca. Không lấy thời gian máy hoặc một người chấm mô phỏng để kết luận tiết kiệm thời gian luật sư.
