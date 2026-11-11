"""Build a credential-free, self-hostable web release from this checkout."""
import hashlib
import json
import stat
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

app = Path(__file__).resolve().parent.parent
project = app.parent.parent
out = project / 'outputs'
work = project / 'work/daitin-webapp'
target = out / 'DAITIN-WEB-MVP-2026.11.11.zip'
prefix = 'DAITIN-WEB-MVP-2026.11.11/'
files = {}
executable = set()
excluded = {'.git', 'node_modules', '__pycache__', 'work', 'runtime', 'evals', 'acceptance', 'pilot'}
distribution = {'start-web.mjs', 'prepare-accounts.mjs', 'seed.mjs', 'health.mjs', 'check.mjs'}
allowed_roots = {'public', 'corpus', 'sot', 'copilot', 'web', 'deploy', 'test', 'distribution'}
allowed_files = {'README.md', 'research.mjs', 'server.mjs', 'compose.web.yaml', '.env.example', '.dockerignore', '.gitignore'}
for path in app.rglob('*'):
    if not path.is_file() or path.is_symlink():
        continue
    rel = path.relative_to(app)
    if any(part in excluded for part in rel.parts):
        continue
    if rel.parts[0] not in allowed_roots and str(rel) not in allowed_files:
        continue
    if rel.parts[0] == 'distribution' and len(rel.parts) == 2 and path.name not in distribution:
        continue
    if path.suffix in {'.key', '.pem', '.log', '.jsonl', '.pyc', '.gguf', '.command', '.sh'}:
        continue
    if path.suffix == '.sqlite' and rel.as_posix() != 'copilot/evidence.sqlite':
        continue
    if path.name in {'accounts.json', 'THONG-TIN-DANG-NHAP.txt', '.DS_Store'}:
        continue
    name = rel.as_posix()
    files[name] = path.read_bytes()
    if path.stat().st_mode & 0o111:
        executable.add(name)

for name in ['DAITIN-WEB-Xem-truoc.html', 'DAITIN-WEB-Huong-dan.html', 'DAITIN-WEB-Nghiem-thu.md',
             'DAITIN-WEB-desktop.jpg', 'DAITIN-WEB-mobile.jpg']:
    files[name] = (out / name).read_bytes()
files['XEM-TRUOC.html'] = files['DAITIN-WEB-Xem-truoc.html']
files['DAITIN-WEB-Huong-dan.html'] = files['DAITIN-WEB-Huong-dan.html'].replace(
    b'href="DAITIN-WEB-MVP-2026.11.11.zip"', b'href="deploy/README-WEB.md"').replace(
    'Tải gói triển khai web'.encode(), 'Hướng dẫn vận hành'.encode())
files['docs/NGHIEM-THU-WEB.md'] = (work / 'ACCEPTANCE.md').read_bytes()
for name in ['mac-ai-qa.json', 'linux-disabled-qa.json', 'regression.log']:
    files['docs/evidence/' + name] = (work / name).read_bytes()
files['BAT-DAU.txt'] = '''DAITIN Copilot: gói web chuẩn bị bàn giao, 11/11/2026

1. Mở DAITIN-WEB-Huong-dan.html để xem trạng thái và phạm vi.
2. Mở XEM-TRUOC.html để xem ngay luồng mô phỏng trên trình duyệt.
3. Kỹ thuật đọc deploy/README-WEB.md để đặt ứng dụng lên máy chủ riêng.
4. AI mặc định chưa bật. Chưa có URL Internet, chưa triển khai lên Base44.
5. Tài khoản mới được tạo tại máy chủ khi khởi động; gói không có khóa hiện tại.

Tám hồ sơ mẫu và các quyết định duyệt là mô phỏng. SOT chờ luật sư duyệt.
Người dùng cuối chỉ cần trình duyệt sau khi máy chủ được triển khai.
'''.encode()
files['RELEASE.json'] = json.dumps({
    'version': 'DT-WEB-MVP-2026.11.11', 'status': 'prepared_local_verification_only',
    'published': False, 'remoteDeployment': None, 'aiDefault': 'disabled',
    'testedRealModel': 'daitin-qwen3-4b-2507 via local loopback, web HTTP pilot on Mac',
    'testedContainer': 'Linux ARM64, read-only root, QA bind mount UID501',
    'productionComposeTested': 'configuration validation only; no public HTTPS or named-volume run',
    'sameModelAgentBaselineThisRelease': 'not measured', 'legalAcceptance': 'pending lawyer review',
    'syntheticCases': 8, 'automatedRegressionChecks': 52, 'sourceStatus': 'candidate',
    'sourceCheckedThrough': '2026-11-10', 'credentialFilesIncluded': False,
    'officialLogoSource': 'https://daitin.com.vn/about/our-identity/',
    'officialLogoSHA256': '28d1e9a0fdbb1975870e713fe72491870f3185668490762d9137921322e01fa4'
}, ensure_ascii=False, indent=2).encode()

# Check actual known local credentials as well as file names. Never print their values.
keys = []
for rel in ['work/daitin-m5/accounts.json', 'work/daitin-webapp/docker-data/accounts.json', 'work/daitin-webapp/ai-data/accounts.json']:
    path = project / rel
    if path.exists():
        # web-qa uses a public repeated-character test value which also occurs in PNG compression.
        keys.extend(row['key'].encode() for row in json.loads(path.read_text()) if row.get('key') and row.get('name') != 'web-qa')
key_path = project / 'work/daitin-m2-runtime/engine.key'
if key_path.exists():
    keys.append(key_path.read_bytes().strip())
for name, body in files.items():
    if any(key and key in body for key in keys):
        raise ValueError('Local credential found in release file: ' + name)
    if name.endswith(('.mjs', '.js', '.html', '.md', '.json', '.css', '.py', '.yaml')) and b'/Users/os/' in body:
        raise ValueError('Host-specific path found in release file: ' + name)
assert not any(name.endswith('.key') or 'accounts.json' == Path(name).name for name in files)
assert files['public/brand/daitin.png'] == (app / 'public/brand/daitin.png').read_bytes()
files['MANIFEST.json'] = json.dumps({'version': 'DT-WEB-MVP-2026.11.11', 'files': {
    name: hashlib.sha256(body).hexdigest() for name, body in sorted(files.items())
}}, ensure_ascii=False, indent=2).encode()

with ZipFile(target, 'w', ZIP_DEFLATED, compresslevel=6) as z:
    for name, body in sorted(files.items()):
        entry = ZipInfo(prefix + name)
        entry.compress_type = ZIP_DEFLATED
        entry.create_system = 3
        entry.external_attr = (stat.S_IFREG | (0o755 if name in executable else 0o644)) << 16
        z.writestr(entry, body)
with ZipFile(target) as z:
    assert z.testzip() is None
    manifest = json.loads(z.read(prefix + 'MANIFEST.json'))
    for name, sha in manifest['files'].items():
        assert hashlib.sha256(z.read(prefix + name)).hexdigest() == sha, name
sha = hashlib.sha256(target.read_bytes()).hexdigest()
target.with_suffix('.zip.sha256').write_text(sha + '  ' + target.name + '\n')
print(json.dumps({'file': str(target), 'files': len(files), 'bytes': target.stat().st_size,
                  'sha256': sha, 'knownLocalCredentialsAbsent': True}))
