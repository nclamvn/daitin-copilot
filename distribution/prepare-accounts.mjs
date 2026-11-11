import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.argv[2]);
mkdirSync(root, { recursive: true, mode: 0o700 });
const file = resolve(root, 'accounts.json');
if (existsSync(file)) process.exit(0);
const accounts = [
  { name: 'luat-su', role: 'reviewer', group: 'nhan-hieu' },
  { name: 'chuyen-vien', role: 'editor', group: 'nhan-hieu' }
].map(item => ({ ...item, key: randomBytes(32).toString('hex') }));
writeFileSync(file, JSON.stringify(accounts, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
writeFileSync(resolve(root, 'THONG-TIN-DANG-NHAP.txt'),
  'DAITIN MVP\n\nTài khoản luật sư: luat-su\nKhóa truy cập: ' + accounts[0].key +
  '\n\nTài khoản chuyên viên: chuyen-vien\nKhóa truy cập: ' + accounts[1].key +
  '\n\nĐây là tài khoản riêng của môi trường pilot này. Nhóm nhan-hieu dùng chung hồ sơ theo phân quyền.\n', { flag: 'wx', mode: 0o600 });
