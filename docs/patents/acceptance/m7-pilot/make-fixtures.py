"""Create deterministic synthetic PDF inputs for the M7 paired pilot."""

import argparse
from hashlib import sha256
import json
from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


AS_OF = '2026-11-11'
TASK_1 = 'Lập ma trận yêu cầu bảo hộ và phản hồi nội bộ theo thông báo. Chỉ dùng các đoạn đã chọn.'
TASK_2 = 'Chỉ sửa phản hồi theo chỉ dẫn mới. Giữ nguyên ma trận đã duyệt và giới hạn ở đoạn D1 được chọn.'
SCOPE = 'Dùng đúng đoạn đã chọn. Phân biệt điều được ghi, điều suy ra và thông tin cần kiểm. Không đưa kết luận pháp lý.'
CASES = [
    {
        'id': 'P01', 'title': 'Bộ tản nhiệt hai kênh', 'd1Page': 1,
        'claim': 'Each coolant channel has its own independently actuated valve.',
        'd1': 'The heat sink contains two parallel coolant channels.',
        'other': 'Each coolant channel has its own independently actuated valve.',
        'notice': 'Làm rõ cách điều khiển riêng từng kênh và căn cứ đối chiếu.',
        'update': 'Thêm một việc cần kiểm trong bản gốc để xác nhận khả năng điều khiển riêng từng kênh.',
    },
    {
        'id': 'P02', 'title': 'Đầu tưới bù áp', 'd1Page': 2,
        'claim': 'An elastic diaphragm regulates pressure upstream of the emitter.',
        'd1': 'A mesh screen filters particles at the inlet of the emitter.',
        'other': 'The irrigation line is fixed by a clip at the end of each row.',
        'notice': 'Tách chức năng lọc cặn và chức năng bù áp khi đối chiếu.',
        'update': 'Thêm yêu cầu chỉ rõ chi tiết cần tìm trong hình cắt của đầu tưới.',
    },
    {
        'id': 'P03', 'title': 'Rơ le bảo vệ nhiệt', 'd1Page': 2,
        'claim': 'The relay trips after 4 seconds above 72 C.',
        'd1': 'The relay trips after 4 seconds above 72 C.',
        'other': 'The enclosure has two mounting slots and a removable cover.',
        'notice': 'Đối chiếu cả ngưỡng nhiệt độ và khoảng thời gian tác động.',
        'update': 'Nêu giá trị và đơn vị của cả hai thông số trong câu kết quả đối chiếu.',
    },
    {
        'id': 'P04', 'title': 'Bộ giám sát rung', 'd1Page': 1,
        'claim': 'The controller triggers an alarm above 35 Hz.',
        'd1': 'The controller triggers an alarm above 53 Hz.',
        'other': 'A different controller triggers an alarm above 35 Hz.',
        'notice': 'Đối chiếu ngưỡng tần số báo động và điều kiện vượt ngưỡng.',
        'update': 'Ghi tách ngưỡng yêu cầu và ngưỡng trong đoạn D1, kèm đơn vị và điều kiện so sánh.',
    },
    {
        'id': 'P05', 'title': 'Van xả đường bơm', 'd1Page': 2,
        'claim': 'The purge valve opens only while the pump is off.',
        'd1': 'The purge valve opens only while the pump is on.',
        'other': 'A manual service switch isolates the power supply.',
        'notice': 'Làm rõ trạng thái bơm tại thời điểm van xả mở.',
        'update': 'Ghi rõ cặp trạng thái bật và tắt. Không suy rộng sang toàn bộ chu kỳ bơm.',
    },
    {
        'id': 'P06', 'title': 'Khóa liên động khử khuẩn', 'd1Page': 1,
        'claim': 'Closing the latch enables the ultraviolet source.',
        'd1': 'A green diode lights after the latch closes.',
        'other': 'Closing the latch enables the ultraviolet source.',
        'notice': 'Đối chiếu quan hệ giữa thao tác đóng chốt và kích hoạt nguồn UV.',
        'update': 'Nêu một chi tiết về sơ đồ hoặc tín hiệu cần kiểm để phân biệt hai chức năng.',
    },
    {
        'id': 'P07', 'title': 'Gói dữ liệu có kiểm lỗi', 'd1Page': 1,
        'claim': 'The packet ends with a two-byte checksum field.',
        'd1': 'The last field of the packet is a 16-bit checksum.',
        'other': 'A clock synchronizes transmission between two nodes.',
        'notice': 'Đối chiếu vị trí, độ dài và chức năng của trường kiểm lỗi.',
        'update': 'Giải thích ngắn cách quy đổi bit sang byte và giữ đúng vị trí trường trong gói.',
    },
    {
        'id': 'P08', 'title': 'Lõi lọc vi lỗ tháo lắp', 'd1Page': 2,
        'claim': 'A cartridge has 20-micrometer pores and can be removed without tools.',
        'd1': 'A cartridge has 20-micrometer pores and sits in a removable tray.',
        'other': 'The cartridge can be removed without tools when the latch is pressed.',
        'notice': 'Đối chiếu riêng kích thước lỗ lọc và khả năng tháo không cần dụng cụ.',
        'update': 'Chia phản hồi thành điểm có căn cứ và điểm cần xác minh. Nêu cách kiểm thao tác tháo.',
    },
]


def make_pdf(path, title, pages):
    document = canvas.Canvas(str(path), pagesize=A4, invariant=True, pageCompression=True)
    document.setTitle(title)
    document.setAuthor('Bộ kiểm thử mô phỏng M7')
    for number, line in enumerate(pages, 1):
        document.setFont('FixtureArial', 9)
        document.drawString(54, 782, 'ĐẠI TÍN  |  HỒ SƠ KIỂM THỬ MÔ PHỎNG')
        document.line(54, 763, 540, 763)
        document.setFont('FixtureArial', 16)
        document.drawString(54, 724, title)
        font_size = 11
        while pdfmetrics.stringWidth(line, 'FixtureArial', font_size) > 486:
            font_size -= 0.25
        if font_size < 9:
            raise ValueError(f'Fixture text too wide: {path.name}')
        document.setFont('FixtureArial', font_size)
        document.drawString(54, 675, line)
        document.setFont('FixtureArial', 9)
        document.drawString(54, 49, 'Dữ liệu giả lập. Dùng để đánh giá quy trình đối chiếu.')
        document.drawRightString(540, 49, str(number))
        document.showPage()
    document.save()


def role_file(output, case_id, role, title, pages, page):
    relative = Path('fixtures') / f'{case_id}-{role}.pdf'
    target = output / relative
    make_pdf(target, f'{case_id} · {title}', pages)
    return {'file': relative.as_posix(), 'page': page, 'quote': pages[page - 1],
            'sha256': sha256(target.read_bytes()).hexdigest(), 'label': f'{case_id} · {title}'}


def generate(output, font):
    pdfmetrics.registerFont(TTFont('FixtureArial', str(font)))
    (output / 'fixtures').mkdir(parents=True, exist_ok=True)
    manifest = {'version': 1, 'synthetic': True, 'cases': []}
    for case in CASES:
        case_id = case['id']
        d1_pages = [case['d1'], case['other']] if case['d1Page'] == 1 else [case['other'], case['d1']]
        manifest['cases'].append({
            'id': case_id, 'title': case['title'], 'reference': f'PAT-M7-PILOT-{case_id}', 'asOf': AS_OF,
            'notice': role_file(output, case_id, 'notice', 'Thông báo mô phỏng',
                                ['Tình huống rà soát nội bộ.', case['notice']], 2),
            'claim': role_file(output, case_id, 'claim', 'Yêu cầu bảo hộ mô phỏng', [case['claim']], 1),
            'd1': role_file(output, case_id, 'd1', 'Đối chứng D1 mô phỏng', d1_pages, case['d1Page']),
            'instructions': SCOPE, 'phase1Task': TASK_1,
            'phase2Instructions': f"{SCOPE} {case['update']}", 'phase2Task': TASK_2,
        })
    (output / 'cases.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    parser.add_argument('--font', type=Path, default=Path('/System/Library/Fonts/Supplemental/Arial.ttf'))
    arguments = parser.parse_args()
    generate(arguments.output, arguments.font)
