"""Read actual exported OOXML for blind scoring, without arm metadata."""
import hashlib
import json
import sys
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile

folder = Path(sys.argv[1])
rows = json.loads((folder / 'manifest.json').read_text())
ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
w = '{' + ns['w'] + '}'
out = []
for row in rows:
    record = {**row, 'artifact': None}
    if row['filename']:
        path = folder / 'blind' / row['filename']
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() != row['sha256']:
            raise ValueError('Artifact fingerprint changed ' + row['code'])
        if row['type'] == 'answer':
            record['artifact'] = json.loads(data)
        else:
            with ZipFile(path) as package:
                body = ET.fromstring(package.read('word/document.xml')).find('w:body', ns)
                sections = []
                metadata = []
                headings = []
                for child in body:
                    text = ' '.join(t.text or '' for t in child.findall('.//w:t', ns))
                    style = child.find('w:pPr/w:pStyle', ns)
                    if style is not None and style.get(w + 'val') == 'Heading1':
                        headings.append(text)
                        sections.append([])
                    elif sections:
                        sections[-1].append(text)
                    else:
                        metadata.append(text)
                record['artifact'] = {
                    'metadata': '\n'.join(metadata),
                    'headings': headings,
                    'sections': {
                        name: '\n'.join(sections[i]) if len(sections) > i else ''
                        for i, name in enumerate(['findings', 'response', 'attachments', 'legal'])
                    },
                    'editable': len(sections) == 4 and all(sections[:3]),
                    'brand': 'word/media/daitin-gray.png' in package.namelist()
                }
    out.append(record)
payload = (json.dumps(out, ensure_ascii=False, indent=2) + '\n').encode()
(folder / 'packets.json').write_bytes(payload)
(folder / 'packets.lock.json').write_text(json.dumps({
    'sha256': hashlib.sha256(payload).hexdigest(),
    'manifestSha256': hashlib.sha256((folder / 'manifest.json').read_bytes()).hexdigest(),
    'artifacts': len(out)
}, indent=2) + '\n')
