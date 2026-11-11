import hashlib
import json
import stat
import sys
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

app = Path(__file__).resolve().parent.parent
project = app.parent.parent
demo = project / 'work/daitin-ceo-release/demo'
guide = project / 'work/daitin-ceo-release/HUONG-DAN.html'
preview = project / 'outputs/DAITIN-MVP-Xem-truoc.html'
target = project / 'outputs/DAITIN-MVP-2026.11.11.zip'
version = 'DT-MVP-2026.11.11'
files = {}
executable = set()
excluded_parts = {'.git', 'node_modules', '__pycache__', 'work', 'test', 'evals', 'acceptance', 'pilot'}
for path in app.rglob('*'):
    if not path.is_file():
        continue
    relative = path.relative_to(app)
    if any(part in excluded_parts for part in relative.parts):
        continue
    if path.name.startswith('.'):
        continue
    if path.suffix in {'.key', '.pem', '.log', '.jsonl', '.pyc'}:
        continue
    if path.suffix == '.sqlite' and relative.as_posix() != 'copilot/evidence.sqlite':
        continue
    name = 'app/' + relative.as_posix()
    files[name] = path.read_bytes()
    if path.stat().st_mode & 0o111:
        executable.add(name)
for path in demo.iterdir():
    if path.suffix in {'.pdf', '.docx', '.txt'} or path.name == 'seed.json':
        files['demo/' + path.name] = path.read_bytes()
files['HUONG-DAN.html'] = guide.read_bytes()
files['Bản xem trước.html'] = preview.read_text().replace('href="DAITIN-MVP-Huong-dan.html"', 'href="HUONG-DAN.html"').encode()
files['Khởi động Đại Tín.command'] = (app / 'distribution/launch.command').read_bytes()
executable.add('Khởi động Đại Tín.command')
files['docs/NGHIEM-THU-M5.md'] = (project / 'outputs/dai-tin-m5-pilot-tu-dong-bao-cao.md').read_text().split('## Tài liệu bàn giao')[0].encode()
files['BAT-DAU.txt'] = """DAITIN Copilot
MVP dùng thử nội bộ 11/11/2026

1. Mở HUONG-DAN.html để xem phạm vi và cách dùng.
2. Mở Bản xem trước.html để xem ngay nguồn, hai phiên và Word mẫu.
3. Bộ chạy đã kiểm trên Mac Apple Silicon có Node.js 24 và Poppler.
4. Nhấp đúp Khởi động Đại Tín.command để dùng mô hình thật.
5. Lần đầu tải mô hình khoảng 2,5 GB. Tài khoản mới nằm trong runtime/pilot/THONG-TIN-DANG-NHAP.txt.

Có 8 hồ sơ mô phỏng. Quyết định duyệt mẫu là thao tác mô phỏng.
Kho nguồn là ứng viên, cần Đại Tín duyệt trước khi dùng cho công việc thực tế.
""".encode()
files['RELEASE.json'] = json.dumps({
    'version': version, 'scope': 'Vietnam national trademark office response',
    'supportedRuntime': 'macOS Apple Silicon, Node.js 24, Poppler',
    'preview': 'guided standalone HTML using synthetic cases and prepared outputs',
    'realModel': 'local Qwen3-4B-Instruct-2507, Q4_K_M, first-run download',
    'dataMode': 'candidate', 'syntheticCases': 8,
    'officialLogoSource': 'https://daitin.com.vn/about/our-identity/',
    'officialLogoSHA256': '28d1e9a0fdbb1975870e713fe72491870f3185668490762d9137921322e01fa4',
    'legalAcceptance': 'pending independent lawyer review',
    'humanEffortTarget': 'not measured',
    'localMachineKeysIncluded': False,
}, ensure_ascii=False, indent=2).encode()
for name, data in files.items():
    if name.endswith(('.mjs', '.js', '.sh', '.command', '.html', '.json', '.css')):
        if b'/Users/os/' in data:
            raise ValueError('Host-specific absolute path in ' + name)
assert files['app/public/brand/daitin.png'] == (app / 'public/brand/daitin.png').read_bytes()
assert not any(name.endswith('.key') or 'accounts.json' in name or '/runtime/' in name for name in files)
manifest = {'version': version, 'files': {name: hashlib.sha256(data).hexdigest() for name, data in sorted(files.items())}}
files['MANIFEST.json'] = json.dumps(manifest, ensure_ascii=False, indent=2).encode()
prefix = 'DAITIN-MVP-2026.11.11/'
with ZipFile(target, 'w', ZIP_DEFLATED, compresslevel=6) as archive:
    for name, data in sorted(files.items()):
        from zipfile import ZipInfo
        entry = ZipInfo(prefix + name)
        entry.compress_type = ZIP_DEFLATED
        entry.create_system = 3
        entry.external_attr = (stat.S_IFREG | (0o755 if name in executable else 0o644)) << 16
        archive.writestr(entry, data)
with ZipFile(target) as archive:
    assert archive.testzip() is None
    loaded = json.loads(archive.read(prefix + 'MANIFEST.json'))
    for name, sha in loaded['files'].items():
        assert hashlib.sha256(archive.read(prefix + name)).hexdigest() == sha, name
sha = hashlib.sha256(target.read_bytes()).hexdigest()
target.with_suffix('.zip.sha256').write_text(sha + '  ' + target.name + '\n')
print(json.dumps({'file': str(target), 'files': len(files), 'bytes': target.stat().st_size, 'sha256': sha}))
