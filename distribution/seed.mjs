import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openCaseStore } from '../copilot/m3/store.mjs';
import { hash } from '../copilot/m3/workflow.mjs';

const root = resolve(process.argv[2]);
const target = process.argv[3] ?? process.env.DAI_TIN_M3_STORE;
if (!target) throw new Error('Cần vị trí lưu hồ sơ pilot.');
const manifest = JSON.parse(readFileSync(resolve(root, 'demo/seed.json'), 'utf8'));
const store = openCaseStore(target, true);
try {
  const existing = store.list('nhan-hieu');
  for (const item of manifest.cases) {
    if (existing.some(row => row.reference === item.matter.reference)) continue;
    if (hash(JSON.stringify(item.matter)) !== item.sha256) throw new Error('Dấu kiểm hồ sơ mẫu không khớp.');
    const pdf = readFileSync(resolve(root, 'demo', item.pdf));
    if (hash(pdf) !== item.matter.document.sha256) throw new Error('PDF mẫu đã đổi.');
    store.create(item.matter, pdf);
  }
} finally {
  store.close();
}
console.log('Đã chuẩn bị ' + manifest.cases.length + ' hồ sơ mô phỏng.');
