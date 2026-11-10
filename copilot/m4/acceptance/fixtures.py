import json
import sys
from io import BytesIO
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)
font = '/System/Library/Fonts/Supplemental/Arial.ttf'
pdfmetrics.registerFont(TTFont('ArialVN', font))
labels = [
    ('Mộc Vân Lab', 'thiết bị đo', 'nhiệt kế điện tử', 'nhiệt kế hồng ngoại', 'standard'),
    ('Lam Sơn Studio', 'thiết bị phát âm', 'loa để bàn', 'loa để bàn có dây', 'multipage'),
    ('An Viên Botanics', 'đồ chứa mẫu', 'lọ thủy tinh', 'lọ thủy tinh có nắp', 'conflict'),
    ('An Nhiên Cycle', 'phụ kiện xe', 'tay nắm xe đạp', 'tay nắm cao su cho xe đạp', 'missing-received'),
    ('Hải Đăng Mộc', 'đồ chiếu sáng', 'đèn bàn', 'đèn LED để bàn', 'scan'),
    ('Minh Châu Paper', 'đồ dùng văn phòng', 'bìa giấy', 'bìa giấy lưu hồ sơ', 'partial-scan'),
    ('Nam Phong Bếp', 'dụng cụ bếp', 'thìa inox', 'thìa inox dùng để đong', 'relative-date'),
    ('Vòm Lá Lab', 'dụng cụ lọc', 'phễu lọc', 'phễu lọc bằng thủy tinh', 'transition'),
]
cases = []
for number, (title, term, old, new, kind) in enumerate(labels, 1):
    key = f'M4-{number:02}'
    received = '2026-06-18' if kind == 'transition' else '2026-09-14'
    application = f'4-2026-{9100 + number}'
    notice_number = f'{130 + number}/TB-M4'
    details = [
        f'Số đơn: {application}', f'Tên nhãn hiệu: {title}',
        *([] if kind == 'missing-received' else ['Ngày cơ quan tiếp nhận đơn: ' + received]),
        f'Số thông báo: {notice_number}', 'Ngày thông báo: 2026-10-26',
        'Hạn phản hồi: theo thông báo, kiểm tra ngày nhận' if kind == 'relative-date' else 'Hạn phản hồi: 2026-11-10'
    ]
    task_line = f'Đề nghị làm rõ cụm “{term}” trong danh mục hàng hóa của đơn.'
    pages = [details + [task_line]]
    if kind in ('multipage', 'partial-scan'):
        pages = [details, [task_line]]
    if kind == 'conflict':
        pages = [[f'Số đơn: 4-2026-0000', f'Tên nhãn hiệu: {title}', 'Dòng số đơn cũ để đối chiếu.'],
                 details + [task_line]]
    scan_pages = [1] if kind == 'scan' else [2] if kind == 'partial-scan' else []
    record = out / key
    record.mkdir(exist_ok=True)
    pdf = canvas.Canvas(str(record / 'thong-bao.pdf'), pagesize=A4, invariant=1)
    pdf.setTitle('Thông báo mô phỏng ' + key)
    for page_num, lines in enumerate(pages, 1):
        content = ['THÔNG BÁO THẨM ĐỊNH MÔ PHỎNG', f'Ca {key}   Trang {page_num}'] + lines
        if page_num in scan_pages:
            image = Image.new('RGB', (1160, 1640), 'white')
            draw = ImageDraw.Draw(image)
            for index, line in enumerate(content):
                draw.text((85, 100 + index * 52), line, fill='black', font=ImageFont.truetype(font, 30))
            pdf.drawImage(ImageReader(image), 0, 0, width=A4[0], height=A4[1])
        else:
            pdf.setFont('ArialVN', 13)
            for index, line in enumerate(content):
                pdf.drawString(46, 776 - index * 25, line)
        pdf.showPage()
    pdf.save()
    instructions = f'Khách hàng xác nhận đề nghị làm rõ cụm “{term}” thành “{old}”. Bảng đối chiếu danh mục đã có sẵn, dự kiến kèm văn bản. Các nội dung khác giữ nguyên.'
    if kind == 'missing-received':
        instructions += ' Biên nhận riêng ghi ngày cơ quan tiếp nhận đơn 14/09/2026.'
    if kind == 'transition':
        instructions += ' Đơn còn đang giải quyết tại 01/07/2026.'
    update = f'Khách hàng xác nhận thay cụm dự kiến thành “{new}”. Giữ bảng đối chiếu danh mục. Có thể bổ sung bản sao thông báo vào danh sách tài liệu nếu luật sư duyệt mục này.'
    (record / 'chi-dan.txt').write_text(instructions, encoding='utf-8')
    (record / 'xac-nhan-moi.txt').write_text(update, encoding='utf-8')
    metadata = {'reference': key, 'title': title, 'asOf': '2026-11-09', 'receivedOn': received,
                'pendingAtCutover': True if kind == 'transition' else None}
    cases.append({
        'case': metadata, 'kind': kind, 'pages': len(pages), 'scanPages': scan_pages,
        'anchorPage': 2 if kind in ('multipage', 'partial-scan', 'conflict') else 1,
        'anchorText': task_line, 'application': application, 'noticeNumber': notice_number,
        'noticeDate': '2026-10-26', 'deadline': None if kind == 'relative-date' else '2026-11-10',
        'old': old, 'new': new,
    })
(out / 'oracle.json').write_text(json.dumps(cases, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
