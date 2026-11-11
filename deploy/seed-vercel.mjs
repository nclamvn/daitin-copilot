import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCaseStore } from '../copilot/m3/store.mjs';
import { hash } from '../copilot/m3/workflow.mjs';
import { createBlobStore } from '../web/blob-store.mjs';
import { makeSnapshot } from '../web/snapshot-runtime.mjs';
import { pilotAccess } from '../copilot/m5/access.mjs';

const store = createBlobStore();
if (await store.read()) throw new Error('Kho pilot đã có dữ liệu. Không ghi đè hoặc tự khởi tạo lại.');
const directory = mkdtempSync(join(tmpdir(), 'codex-tmp-daitin-seed-' + new Date().toISOString().slice(0, 10).replaceAll('-', '') + '-'));
const path = join(directory, 'seed.sqlite');
try {
  const accounts = JSON.parse(process.env.DAI_TIN_M5_ACCOUNTS_JSON ?? 'null');
  const accountsPath = join(directory, 'accounts.json');
  writeFileSync(accountsPath, JSON.stringify(accounts), { mode: 0o600 });
  pilotAccess(accountsPath); // Validate operator-created credentials before any upload.
  const manifest = JSON.parse(readFileSync(new URL('../distribution/demo/seed.json', import.meta.url)));
  const cases = openCaseStore(path, true);
  try {
    for (const item of manifest.cases) {
      const bytes = readFileSync(new URL('../distribution/demo/' + item.pdf, import.meta.url));
      if (hash(JSON.stringify(item.matter)) !== item.sha256 || hash(bytes) !== item.matter.document.sha256 || item.matter.demo !== true) {
        throw new Error('Hồ sơ mô phỏng chưa khớp dấu kiểm.');
      }
      cases.create(item.matter, bytes);
    }
  } finally { cases.close(); }
  const written = await store.write(makeSnapshot(readFileSync(path), { accounts }), null);
  console.log('Đã khởi tạo 8 hồ sơ mô phỏng và tài khoản pilot mới vào kho riêng. Không có khóa trong mã nguồn hoặc gói công khai.');
  console.log('Dấu kiểm phiên lưu:', written.etag);
} finally { rmSync(directory, { recursive: true, force: true }); }
