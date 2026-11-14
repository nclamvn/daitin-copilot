import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { validateDeploymentConfig } from './check-config.mjs';
import { loadDataset, validateDataset } from '../patents/dataset.mjs';
import { inspectSnapshot } from '../web/snapshot-runtime.mjs';
import { loadPilotExercise } from '../patents/pilot-exercise.mjs';

if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node.js 24 trở lên được yêu cầu.');
for (const path of ['public/brand/daitin.png', 'public/fonts.css', 'copilot/evidence.sqlite',
  'copilot/m4/brand/daitin-gray.png', 'distribution/demo/seed.json', 'api/index.mjs', 'patents/service.mjs', 'patents/workflow.mjs',
  'patents/word.mjs', 'patents/ui/index.html', 'patents/ui/app.mjs', 'patents/data/catalog.json']) {
  if (!existsSync(new URL('../' + path, import.meta.url))) throw new Error('Thiếu thành phần triển khai: ' + path);
}
const digest = createHash('sha256').update(readFileSync(new URL('../public/brand/daitin.png', import.meta.url))).digest('hex');
if (digest !== '28d1e9a0fdbb1975870e713fe72491870f3185668490762d9137921322e01fa4') throw new Error('Logo không khớp nguồn đã kiểm.');
// Import validates built-in syntax without creating mutable pilot data or invoking AI.
if (typeof inspectSnapshot !== 'function') throw new Error('Adapter lưu trữ chưa có.');
const catalogue = loadDataset();
const patentDataset = validateDataset(catalogue);
const exercise = loadPilotExercise();
const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url)));
validateDeploymentConfig(config, [
  'copilot/m4/pdf-js-worker.mjs', 'copilot/m4/brand/daitin-gray.png', 'copilot/evidence.sqlite',
  'distribution/demo/seed.json', 'public/fonts.css', 'patents/service.mjs', 'patents/workflow.mjs', 'patents/store.mjs',
  'advice/ui/index.html', 'advice/ui/email.mjs', 'advice/library/index.json', 'advice/library/public-index.json', 'advice/public/index.json',
  'patents/word.mjs', 'patents/dataset.mjs', 'patents/ui/index.html', 'patents/ui/app.css', 'patents/ui/app.mjs', 'patents/data/catalog.json',
  'patents/data/pilot-exercise/manifest.json', 'patents/data/pilot-exercise/lock.json',
  ...exercise.files.map(file => 'patents/data/pilot-exercise/' + file.name),
  'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', 'node_modules/pdfjs-dist/standard_fonts/FoxitSerif.pfb',
  'node_modules/pdfjs-dist/cmaps/Adobe-Japan1-UCS2.bcmap',
  'node_modules/@napi-rs/canvas-linux-x64-gnu/skia.linux-x64-gnu.node',
  ...catalogue.sources.flatMap(source => [source.snapshot, source.textPath, source.ocrReceipt].filter(Boolean))
]);
console.log('Nguồn sáng chế ứng viên đã kiểm cấu trúc, hash và exact span: ' + patentDataset.sources + ' nguồn / ' + patentDataset.records + ' đoạn. Đây không phải xác minh nội dung pháp lý.');
console.log('Node, tài nguyên gói và logo đã kiểm; build không ghi hoặc gửi dữ liệu pilot.');
