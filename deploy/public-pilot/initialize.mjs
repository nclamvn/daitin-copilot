import { chmodSync, copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

const dir = process.argv[2];
const keys = [process.env.PILOT_BINH_KEY, process.env.PILOT_GRADER_KEY];
if (keys.some(key => !/^[a-f0-9]{64}$/.test(key ?? '')) || keys[0] === keys[1]) {
  throw new Error('Cần hai khóa riêng qua biến bảo mật dịch vụ.');
}
for (const name of ['advice.sqlite', 'release.json']) {
  const file = join(dir, name);
  if (!existsSync(file)) {
    const pending = file + '.pending';
    copyFileSync(join('/opt/seed', name), pending);
    chmodSync(pending, 0o600);
    renameSync(pending, file);
  }
}
const accounts = keys.map((key, i) => ({ name: i ? 'cham-mu' : 'binh', key, role: 'reviewer', group: 'nhan-hieu' }));
const accountsPath = join(dir, 'accounts.json');
const pending = accountsPath + '.pending';
writeFileSync(pending, JSON.stringify(accounts) + '\n', { mode: 0o600 });
renameSync(pending, accountsPath);

const modelKey = join(dir, 'local-model.key');
if (!existsSync(modelKey)) writeFileSync(modelKey, randomBytes(32).toString('hex') + '\n', { mode: 0o600, flag: 'wx' });
if (!/^[a-f0-9]{64}$/.test(readFileSync(modelKey, 'utf8').trim())) throw new Error('Khóa model chưa hợp lệ.');
