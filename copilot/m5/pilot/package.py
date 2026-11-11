"""Create an arm-blind review pack, reusing the existing M5 review forms."""
import html
import json
import re
import sys
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

run, forms, target = map(Path, sys.argv[1:4])
manifest = json.loads((run / 'manifest.json').read_text())
fixtures = json.loads((run / 'fixtures.private.json').read_text())
assert len(manifest) == 80 and len(fixtures) == 30
files = {}
index = []
for row in manifest:
    name = 'dau-ra/' + row['filename'] if row['filename'] else None
    index.append({key: value for key, value in {
        'code': row['code'], 'case': row['case'], 'phase': row['phase'], 'filename': name
    }.items()})
    if name:
        files[name] = (run / 'blind' / row['filename']).read_bytes()
for entry in fixtures:
    data = {key: entry[key] for key in ('id', 'reference', 'request')}
    for key in ('title', 'facts', 'notice', 'instructions', 'update', 'draft', 'revise'):
        if key in entry:
            data[key] = entry[key]
    files['de-bai/' + entry['id'] + '.json'] = json.dumps(data, ensure_ascii=False, indent=2).encode()

with ZipFile(forms) as prior:
    timer = prior.read('01-do-thao-tac.html').decode().replace('daitin-m5-pilot-time-v1', 'daitin-m5-pilot-time-v2')
    grade = prior.read('02-cham-mu.html').decode()
    grade = grade.replace('daitin-m5-blind-v1', 'daitin-m5-blind-v2-auto80')
    grade = grade.replace('data.length!==60', 'data.length!==80').replace('size!==60', 'size!==80')
    grade = grade.replace('/^([QS]\\d{2}|W\\d{2}-[AB]-P[12])$/', '/^BL-[A-F0-9]{12}$/')
    grade = grade.replace("!/^dau-ra\\/[A-Z0-9a-z.-]+\\.(json|docx)$/.test(r.filename)",
                          "!(r.filename===null||/^dau-ra\\/[A-Z0-9a-z.-]+\\.(json|docx)$/.test(r.filename))")
    files['01-do-thao-tac.html'] = timer.encode()
    files['02-cham-mu.html'] = grade.encode()
files['index.json'] = json.dumps(index, ensure_ascii=False, indent=2).encode()
files['manifest.json'] = (run / 'manifest.json').read_bytes()
files['HUONG-DAN.md'] = """# Chấm mù pilot M5

Bộ này có 30 ca và 80 đầu ra. Q01–Q12 là câu hỏi tra cứu. S01–S08 cần hỏi lại, dừng hoặc chuyển kiểm riêng.
W01–W10 là hồ sơ phản hồi thẩm định qua hai phiên. Có hai đầu ra cho từng câu hỏi và bốn Word cho mỗi hồ sơ hai phiên.
Mã BL đã được xáo, người chấm không được cấp khóa nhánh.

Mở index.html để xem đề bài và đầu ra. Mở 02-cham-mu.html và chọn index.json để chấm.
Đọc nguồn ở đúng trang và kiểm mốc áp dụng. Mỗi mục có điểm 0 nếu sai hoặc thiếu, 1 nếu cần sửa và 2 nếu đạt.
Với ca cần dừng, câu hỏi làm rõ hoặc chuyển sang WIPO đúng phạm vi được coi là hoàn thành.
Với Word, kiểm cụm hàng hóa đã xác nhận mới nhất, tài liệu dự kiến kèm, bản duyệt và phần cần giữ nguyên ở phiên hai.
Ghi rõ vị trí khi có lỗi trọng yếu. Chốt điểm trước khi điều phối viên giải mã.

01-do-thao-tac.html dùng cho người thực hiện 10 hồ sơ W qua hai phiên trên từng nhánh.
Tách thời gian thao tác, chờ model và nghỉ. Phép đo tự động được báo riêng.
Dữ liệu tình huống là mô phỏng đã dùng trong phát triển. Bộ chấm LLM là giả lập và dùng cùng họ model soạn.
""".encode()
rows = []
for fixture in fixtures:
    case = fixture['id']
    links = []
    for row in index:
        if row['case'] != case:
            continue
        phase = 'Tra cứu' if row['phase'] == 0 else 'Phiên ' + str(row['phase'])
        if row['filename']:
            links.append('<a href="' + html.escape(row['filename']) + '">' + row['code'] + ' · ' + phase + '</a>')
        else:
            links.append('<span>' + row['code'] + ' · Thiếu đầu ra</span>')
    rows.append('<article><h2>' + case + '</h2><p>' + html.escape(fixture['request']['question']) +
                '</p><a href="de-bai/' + case + '.json">Mở dữ kiện và chỉ dẫn</a><div>' + ''.join(links) + '</div></article>')
page = """<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Đại Tín Pilot M5</title><style>
body{margin:0;background:#f0f3f1;color:#182b2e;font:14px/1.6 system-ui,sans-serif}
main{max-width:1020px;margin:auto;padding:28px 18px}h1{font-size:34px;letter-spacing:-.04em;margin:8px 0}
h2{margin:0;font-size:18px}p{max-width:75ch}a{color:#174d42;text-underline-offset:3px}
article{background:#fff;border:1px solid #d7e0dc;border-radius:8px;padding:18px;margin:12px 0}
article div{display:flex;gap:9px;flex-wrap:wrap;margin-top:8px}article div a{border:1px solid #d7e0dc;padding:5px 9px;border-radius:4px;text-decoration:none}
:focus-visible{outline:2px solid #174d42;outline-offset:3px}
</style><main><p>Đại Tín · Pilot M5</p><h1>Hồ sơ chấm mù</h1>
<p>30 ca mô phỏng gồm tra cứu, xác nhận dữ kiện và công việc qua hai phiên. Mã đầu ra đã được ẩn nhánh.</p>
<p><a href="02-cham-mu.html">Mở phiếu chấm</a> · <a href="01-do-thao-tac.html">Đo thao tác</a> · <a href="HUONG-DAN.md">Hướng dẫn</a></p>
""" + ''.join(rows) + '</main></html>'
files['index.html'] = page.encode()
with ZipFile(target, 'w', ZIP_DEFLATED) as archive:
    for name, value in sorted(files.items()):
        archive.writestr(name, value)
with ZipFile(target) as archive:
    assert archive.testzip() is None
    assert not any('private' in name or 'account' in name or 'score' in name for name in archive.namelist())
print(target)
