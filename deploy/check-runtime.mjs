import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inspectSnapshot } from '../web/snapshot-runtime.mjs';

if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node.js 24 trở lên được yêu cầu.');
for (const path of ['public/brand/daitin.png', 'public/fonts.css', 'copilot/evidence.sqlite',
  'copilot/m4/brand/daitin-gray.png', 'distribution/demo/seed.json', 'api/index.mjs']) {
  if (!existsSync(new URL('../' + path, import.meta.url))) throw new Error('Thiếu thành phần triển khai: ' + path);
}
const digest = createHash('sha256').update(readFileSync(new URL('../public/brand/daitin.png', import.meta.url))).digest('hex');
if (digest !== '28d1e9a0fdbb1975870e713fe72491870f3185668490762d9137921322e01fa4') throw new Error('Logo không khớp nguồn đã kiểm.');
// Import validates built-in syntax without creating mutable pilot data or invoking AI.
if (typeof inspectSnapshot !== 'function') throw new Error('Adapter lưu trữ chưa có.');
console.log('Node, tài nguyên gói và logo đã kiểm; build không ghi hoặc gửi dữ liệu pilot.');
