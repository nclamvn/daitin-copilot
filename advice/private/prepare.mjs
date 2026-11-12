import { existsSync, mkdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const directory = resolve(process.argv[2]);
const repo = realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
if (directory === repo || directory.startsWith(repo + sep)) throw new Error('Tài khoản kho riêng cần lưu ngoài repo.');
mkdirSync(directory, { recursive: true, mode: 0o700 });
const canonical = realpathSync(directory);
if (canonical === repo || canonical.startsWith(repo + sep)) throw new Error('Tài khoản kho riêng cần lưu ngoài repo.');
const info = statSync(canonical);
if (!info.isDirectory() || info.uid !== process.getuid() || (info.mode & 0o077)) throw new Error('Thư mục kho riêng cần quyền 0700.');
const path = resolve(directory, 'accounts.json');
if (!existsSync(path)) {
  const accounts = [
    { name: 'binh', role: 'reviewer' },
    { name: 'cham-mu', role: 'reviewer' },
    { name: 'nhap-nguon', role: 'editor' },
  ].map(actor => ({ ...actor, group: 'nhan-hieu', key: randomBytes(32).toString('hex') }));
  writeFileSync(path, JSON.stringify(accounts, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  writeFileSync(resolve(directory, 'THONG-TIN-DANG-NHAP.txt'),
    'Tài khoản kho cục bộ Đại Tín\n\n' + accounts.map(actor => actor.name + '\n' + actor.key).join('\n\n') + '\n',
    { flag: 'wx', mode: 0o600 });
}
const modelKey = resolve(directory, 'local-model.key');
if (!existsSync(modelKey)) writeFileSync(modelKey, randomBytes(32).toString('hex') + '\n', { flag: 'wx', mode: 0o600 });
