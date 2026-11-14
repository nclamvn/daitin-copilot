import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { digest } from './store.mjs';

const directory = process.argv[2];
if (!directory) throw new Error('Cần đường dẫn đến kho pilot công khai đã khóa.');
const release = JSON.parse(readFileSync(resolve(directory, 'release.json'), 'utf8'));
const policy = JSON.parse(readFileSync(new URL('./public-release.json', import.meta.url), 'utf8'));
const publicNames = Object.keys(policy.reviewed).map(id => id + '.docx').sort();
const store = new DatabaseSync(resolve(directory, 'advice.sqlite'), { readOnly: true });
try {
  store.exec('BEGIN');
  const rows = store.prepare('SELECT data FROM review WHERE active = 1 ORDER BY id').all().map(({ data }) => JSON.parse(data));
  const documents = store.prepare('SELECT sha, name FROM intake ORDER BY sha').all();
  if (JSON.stringify(documents.map(row => row.name).sort()) !== JSON.stringify(publicNames) ||
      JSON.stringify(documents.map(row => row.sha)) !== JSON.stringify(release.documents) ||
      JSON.stringify(rows.map(row => row.id)) !== JSON.stringify(release.approved) ||
      digest(JSON.stringify(rows)) !== release.version ||
      JSON.stringify(rows.map(row => row.title).sort()) !== JSON.stringify(publicNames) ||
      rows.some(row => row.simulated !== false || !row.reviewed || !row.origin ||
        policy.reviewed[row.title.replace(/\.docx$/, '')]?.statement !== row.statement || row.clientText !== row.statement)) {
    throw new Error('Kho không khớp bảy đoạn công khai đã duyệt.');
  }
  const selected = rows.map(({ id, kind, scope, issuer, quote, title, value, file, paragraph, sha256, quoteSha256,
    layers, supersedes, date, origin, locator, statement, clientText, simulated, reviewed }) =>
    ({ id, kind, scope, issuer, quote, title, value, file, paragraph, sha256, quoteSha256,
      layers, supersedes, date, origin, locator, statement, clientText, simulated, reviewed }));
  writeFileSync(new URL('../library/public-index.json', import.meta.url), JSON.stringify({
    schema: 1, simulation: false, version: release.version, reviewedOn: policy.reviewedOn, rows: selected,
  }, null, 2) + '\n');
  console.log('Đã xuất', selected.length, 'đoạn công khai, phiên bản', release.version);
} finally {
  store.close();
}
