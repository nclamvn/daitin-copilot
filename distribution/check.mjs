import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';

const root = resolve(process.argv[2]);
const manifest = JSON.parse(readFileSync(resolve(root, 'MANIFEST.json'), 'utf8'));
for (const [name, expected] of Object.entries(manifest.files)) {
  const path = resolve(root, name);
  if (!path.startsWith(root + sep)) throw new Error('Đường dẫn gói không hợp lệ.');
  const hash = createHash('sha256').update(readFileSync(path)).digest('hex');
  if (hash !== expected) throw new Error('Tệp đã thay đổi hoặc giải nén chưa đủ: ' + name);
}
console.log('Gói ' + manifest.version + ' đã đủ tệp và khớp dấu kiểm.');
