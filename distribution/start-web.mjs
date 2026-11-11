import { chmodSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { webSettings } from '../web/security.mjs';

if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Máy chủ cần Node.js 24 trở lên.');
const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const data = resolve(process.env.DAI_TIN_DATA_DIR ?? resolve(app, 'work/web-data'));
Object.assign(process.env, {
  DAI_TIN_WEB: '1', DAI_TIN_M5: '1', DAI_TIN_M4: '1', DAI_TIN_M3: '1', DAI_TIN_PATENTS: '1',
  DAI_TIN_COPILOT: '1', DAI_TIN_PILOT: '1', DAI_TIN_CORPUS_MODE: 'preview',
  DAI_TIN_M5_ACCOUNTS: resolve(data, 'accounts.json'), DAI_TIN_M3_STORE: resolve(data, 'pilot.sqlite'),
  DAI_TIN_MODEL_LOG: resolve(data, 'model-audit.jsonl'),
  PORT: process.env.PORT ?? '4320', DAI_TIN_BIND: process.env.DAI_TIN_BIND ?? '127.0.0.1',
  DAI_TIN_MODEL_MODE: process.env.DAI_TIN_MODEL_MODE ?? 'disabled'
});
const web = webSettings();
mkdirSync(data, { recursive: true, mode: 0o700 });
chmodSync(data, 0o700);
for (const tool of ['pdfinfo', 'pdftotext', 'pdftoppm']) execFileSync(tool, ['-v'], { stdio: 'pipe' });
execFileSync(process.execPath, [resolve(app, 'distribution/prepare-accounts.mjs'), data], { stdio: 'inherit' });
execFileSync(process.execPath, [resolve(app, 'distribution/seed.mjs'), resolve(app, 'distribution'), process.env.DAI_TIN_M3_STORE], { stdio: 'inherit' });
const { createServer } = await import('../server.mjs');
const port = Number(process.env.PORT);
const bind = process.env.DAI_TIN_BIND;
if (!Number.isInteger(port) || port < 1024 || port > 65535 || !['127.0.0.1', '0.0.0.0'].includes(bind)) {
  throw new Error('Địa chỉ máy chủ chưa hợp lệ.');
}
const server = createServer();
server.listen(port, bind, () => {
  console.log('DAITIN Web pilot • ' + web.origin + '/patents/');
  console.log('Tài khoản mới: ' + resolve(data, 'THONG-TIN-DANG-NHAP.txt'));
  console.log(process.env.DAI_TIN_MODEL_MODE === 'disabled' ? 'AI chưa bật. Có thể tra cứu, sửa tay và xuất bản duyệt.' : 'AI dùng cấu hình của máy chủ.');
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
});
