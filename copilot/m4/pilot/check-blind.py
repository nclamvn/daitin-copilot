"""Mechanical scoring over an arm-blind manifest and actual exported Word files."""
import json
import re
import sys
import unicodedata
from pathlib import Path
from docx import Document

folder, oracle_path, target = map(Path, sys.argv[1:4])
oracles = {item['case']['reference']: item for item in json.loads(oracle_path.read_text())}
index = json.loads((folder / 'index.json').read_text())
assert len(index) == 32 and all(set(row) == {'code', 'case', 'phase', 'filename'} for row in index)

def fold(text):
    return re.sub(r'\s+', ' ', unicodedata.normalize('NFC', text)).casefold().strip()

results = []
legal_in_body = re.compile(r'(?<!\w)(?:điều\s+\d+|khoản\s+\d+|thông\s+tư\s+(?:số\s+)?\d+|nghị\s+định\s+(?:số\s+)?\d+|(?:luật|tcvl|tcvn)\s+(?:số\s+)?\d+)')
for row in index:
    item = oracles[row['case']]
    result = {'code': row['code'], 'case': row['case'], 'phase': row['phase']}
    if row['filename'] is None:
        results.append({**result, 'status': 'blocked', 'checks': {}, 'notes': ['Chưa có Word để chấm.']})
        continue
    document = Document(folder / row['filename'])
    headers = [i for i, p in enumerate(document.paragraphs) if p.style.name == 'Heading 1']
    assert len(headers) == 4
    findings, response, attachments = [
        fold(' '.join(p.text for p in document.paragraphs[left+1:right]))
        for left, right in zip(headers, headers[1:])
    ]
    grids = fold(' '.join(cell.text for table in document.tables for r in table.rows for cell in r.cells))
    term = fold(re.search(r'“([^”]+)”', item['anchorText']).group(1))
    old, new = fold(item['old']), fold(item['new'])
    intended = old if row['phase'] == 1 else new
    stale = row['phase'] == 2 and old in response.replace(new, '')
    notice_date = '/'.join(reversed(item['noticeDate'].split('-')))
    required_citations = ['điều 83 khoản 2 điểm b', '10/2026/tt-bkhcn', 'trang pdf 102']
    if item['kind'] == 'transition':
        required_citations.extend(('điều 17 khoản 2', 'điều 18 khoản 2', '20/2026/tt-bkhcn', 'trang pdf 14'))
    checks = {
        'metadata': all(fold(value) in grids for value in (item['application'], item['noticeNumber'], item['case']['title'], notice_date)),
        'findings': term in findings,
        'updated_goods': intended in response and not stale,
        'retained_attachments': 'bảng đối chiếu' in attachments and 'dự kiến' in attachments and 'bản sao thông báo' not in attachments,
        'legal_locator': all(value in grids for value in required_citations),
        'no_unverified_legal_in_body': not legal_in_body.search(' '.join((findings, response, attachments))),
        'version': any(f'bản duyệt nội bộ {row["phase"]}' in fold(cell.text)
                       for table in document.tables for r in table.rows for cell in r.cells),
        'editable_brand': len(document.inline_shapes) == 1 and bool(response) and bool(findings),
        'no_hold_mark': '[luật sư xác nhận]' not in ' '.join((findings, response, attachments))
    }
    grades = {
        'facts': 2 if checks['metadata'] else 0,
        'basis': 2 if checks['legal_locator'] and checks['no_unverified_legal_in_body'] else 0,
        'content': max(0, sum(checks[k] for k in ('findings', 'updated_goods', 'retained_attachments')) - 1),
        'version': sum(checks[k] for k in ('version', 'editable_brand'))
    }
    results.append({**result, 'status': 'pass' if all(checks.values()) else 'check', 'checks': checks,
                    'critical': any(not checks[key] for key in ('metadata', 'legal_locator', 'no_unverified_legal_in_body', 'version')),
                    'grades': grades, 'total': sum(grades.values()),
                    'notes': [key for key, passed in checks.items() if not passed]})
target.write_text(json.dumps(results, ensure_ascii=False, indent=2) + '\n')
