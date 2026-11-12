import { createHash } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createIndex, labels } from '../library/retrieval.mjs';

export const maxSource = 12 * 1024 * 1024;
const repo = realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
const extractor = fileURLToPath(new URL('./extract.py', import.meta.url));
export const digest = value => createHash('sha256').update(value).digest('hex');
const hex = /^[a-f0-9]{64}$/;
let publicCards;
const issuerCode = /^[a-z0-9-]{1,50}$/;
const scopeValues = [
  ['signed', 'Cần POA đã ký'], ['signed-owner', 'Chủ sở hữu ký'], ['notary', 'Cần công chứng'],
  ['reuse-valid', 'Có thể dùng lại nếu đáp ứng điều kiện'], ['agent-signed', 'Qua đại diện cần POA đã ký'],
  ['new', 'Cần POA mới'], ['reuse', 'Chấp nhận POA đã lưu'], ['none', 'Không cần POA'],
  ['agent-required', 'Nộp qua đại diện cần văn bản ủy quyền'],
  ['documents', 'Danh mục đã xác nhận'], ['deadline', 'Thời hạn đã xác nhận'], ['fee', 'Chi phí đã xác nhận'],
  ['verify-office-record', 'Chỉ dẫn bước xác nhận'], ['expired', 'Đã hết hiệu lực'],
];
export const reviewOptions = { labels, values: scopeValues };
const fieldValues = {
  poa: new Set(scopeValues.slice(0, 9).map(([value]) => value)),
  documents: new Set(['documents']), deadline: new Set(['deadline']), fee: new Set(['fee']),
};
export class PrivateError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const reject = (message, status) => { throw new PrivateError(message, status); };

export function bounded(value, max, min = 1) {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max || value.includes('\0')) {
    reject('Thiếu thông tin hoặc nội dung vượt giới hạn.');
  }
  return value.trim();
}

function publicCard(source, paragraphs) {
  publicCards ??= new Map(JSON.parse(readFileSync(new URL('./public-candidates.json', import.meta.url), 'utf8'))
    .map(item => [item.id + '.docx', item]));
  const known = publicCards.get(source.name);
  if (!known || paragraphs[0] !== 'Đoạn nguồn công khai · Chờ luật sư duyệt') return null;
  if (paragraphs[2] !== known.excerpt) reject('Đoạn của phiếu công khai khác bản chụp đã đối chiếu.', 409);
  const origin = paragraphs[4]?.replace(/^Nguồn · /u, '');
  if (origin !== known.origin) reject('Đường dẫn của phiếu công khai khác nguồn đã đối chiếu.', 409);
  const { scope, value, issuer, statement, locator, page } = known;
  return { paragraph: 3, scope, value, issuer, statement, locator, page, origin, retired: known.retired === true };
}

function privateDirectory(directory) {
  if (!isAbsolute(directory ?? '')) throw new Error('Kho cần thư mục tuyệt đối ngoài repo.');
  const location = realpathSync(directory);
  const info = statSync(location);
  const rel = relative(repo, location);
  if (!rel.startsWith('..' + sep) || !info.isDirectory() || info.uid !== process.getuid() || (info.mode & 0o077)) {
    throw new Error('Kho riêng cần thư mục ngoài repo, do chủ máy sở hữu và có quyền 0700.');
  }
  return location;
}

function parseSource(bytes, kind) {
  return new Promise((resolve, fail) => {
    const child = spawn('python3', [extractor, kind], { stdio: ['pipe', 'pipe', 'ignore'], timeout: 12000 });
    const chunks = [];
    let length = 0;
    child.stdin.on('error', () => {});
    child.on('error', () => fail(new PrivateError('Chưa mở được bộ đọc tệp.')));
    child.stdout.on('data', data => {
      length += data.length;
      if (length > 16 * 1024 * 1024) child.kill();
      else chunks.push(data);
    });
    child.on('close', code => {
      if (code !== 0) return fail(new PrivateError('Tệp hỏng, quá giới hạn hoặc thiếu phần văn bản hỗ trợ.'));
      try {
        const list = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!Array.isArray(list) || !list.some(line => line.trim())) reject('Tệp không có đoạn văn bản đọc được.');
        resolve(list);
      } catch {
        fail(new PrivateError('Không đọc được văn bản từ tệp.'));
      }
    });
    child.stdin.end(bytes);
  });
}

export function openPrivateStore(directory) {
  const filename = join(privateDirectory(directory), 'advice.sqlite');
  if (existsSync(filename)) {
    const info = lstatSync(filename);
    if (!info.isFile() || info.uid !== process.getuid() || (info.mode & 0o077)) throw new Error('SQLite riêng cần quyền 0600.');
  }
  const db = new DatabaseSync(filename);
  chmodSync(filename, 0o600);
  db.exec(`
    PRAGMA foreign_keys=ON;
    PRAGMA busy_timeout=3000;
    CREATE TABLE IF NOT EXISTS intake (sha TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL,
      owner TEXT NOT NULL, permission TEXT NOT NULL, imported_by TEXT NOT NULL, bytes BLOB NOT NULL, paragraphs TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS review (id TEXT PRIMARY KEY, doc TEXT NOT NULL REFERENCES intake(sha), data TEXT NOT NULL,
      active INTEGER NOT NULL CHECK (active IN (0,1)));
    CREATE TABLE IF NOT EXISTS activity (seq INTEGER PRIMARY KEY, event TEXT NOT NULL, actor TEXT NOT NULL,
      target TEXT NOT NULL, detail TEXT NOT NULL, at INTEGER NOT NULL);
    CREATE TRIGGER IF NOT EXISTS activity_no_update BEFORE UPDATE ON activity BEGIN SELECT RAISE(ABORT,'immutable activity'); END;
    CREATE TRIGGER IF NOT EXISTS activity_no_delete BEFORE DELETE ON activity BEGIN SELECT RAISE(ABORT,'immutable activity'); END;
    CREATE TABLE IF NOT EXISTS pilot (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS attempt (id TEXT PRIMARY KEY, pilot TEXT NOT NULL REFERENCES pilot(id), data TEXT NOT NULL);
  `);
  const tx = work => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  };
  const audit = (event, actor, target, detail = {}) => db.prepare('INSERT INTO activity(event,actor,target,detail,at) VALUES(?,?,?,?,?)')
    .run(event, actor, target, JSON.stringify(detail), Date.now());
  const revisions = () => db.prepare('SELECT id,doc,data,active FROM review ORDER BY id').all();
  const getSource = sha => {
    if (!hex.test(sha)) reject('Mã nguồn không hợp lệ.', 404);
    const source = db.prepare('SELECT sha,name,kind,owner,permission,imported_by,paragraphs FROM intake WHERE sha=?').get(sha);
    if (!source) reject('Không tìm thấy nguồn.', 404);
    return source;
  };
  const storedFile = id => {
    const row = db.prepare('SELECT bytes,sha,name,kind FROM intake WHERE sha=?').get(id);
    if (!row) reject('Không tìm thấy tệp.', 404);
    const bytes = Buffer.from(row.bytes);
    if (digest(bytes) !== row.sha) reject('Tệp gốc lệch dấu kiểm. Kho đã dừng.', 409);
    return { bytes, name: row.name, kind: row.kind };
  };
  let cached;

  function publish() {
    const decisions = new Map();
    for (const item of db.prepare("SELECT event,target,detail FROM activity WHERE event IN ('approved','withdrawn') ORDER BY seq").all()) {
      decisions.set(item.target, item);
    }
    const rows = [];
    const checkedDocs = new Map();
    for (const entry of revisions()) {
      const event = decisions.get(entry.id);
      if (!event || Boolean(entry.active) !== (event.event === 'approved') ||
          (entry.active && entry.data !== event.detail)) reject('Quyết định nguồn lệch nhật ký. Kho đã dừng.', 409);
      decisions.delete(entry.id);
      if (!entry.active) continue;
      const row = JSON.parse(entry.data);
      if (!checkedDocs.has(row.sha256)) {
        storedFile(row.sha256);
        checkedDocs.set(row.sha256, JSON.parse(getSource(row.sha256).paragraphs));
      }
      const quote = checkedDocs.get(row.sha256)[row.paragraph - 1];
      if (typeof quote !== 'string' || quote !== row.quote || digest(quote) !== row.quoteSha256) {
        reject('Đoạn gốc lệch dấu kiểm. Kho đã dừng.', 409);
      }
      rows.push(row);
    }
    if (decisions.size) reject('Thiếu bản ghi nguồn đã duyệt. Kho đã dừng.', 409);
    const version = digest(JSON.stringify(rows));
    if (cached?.version === version) return cached;
    const bundle = { schema: 1, simulation: false, rows };
    const index = createIndex(bundle, { privateLibrary: true });
    cached = { version, rows, index };
    return cached;
  }

  return {
    db, tx, audit, publish, close: () => db.close(),
    async importFile(body, actor) {
      const name = bounded(body?.name, 240).replace(/[\\/\r\n]/g, '_');
      const extension = name.split('.').at(-1)?.toLowerCase();
      const kind = extension === 'docx' ? 'word' : extension === 'eml' ? 'email' : null;
      if (!kind || body.allowed !== true) reject('Chọn DOCX hoặc EML và xác nhận quyền sử dụng.');
      const owner = bounded(body.owner, 160);
      const permission = bounded(body.permission, 500, 4);
      const encoded = bounded(body.base64, Math.ceil(maxSource / 3) * 4);
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4) reject('Dữ liệu tệp chưa đúng định dạng.');
      const bytes = Buffer.from(encoded, 'base64');
      if (!bytes.length || bytes.length > maxSource) reject('Giới hạn 12 MiB mỗi tệp.');
      const sha = digest(bytes);
      if (db.prepare('SELECT 1 FROM intake WHERE sha=?').get(sha)) return { sha, duplicate: true };
      const paragraphs = await parseSource(bytes, kind);
      publicCard({ name }, paragraphs);
      return tx(() => {
        const result = db.prepare('INSERT OR IGNORE INTO intake VALUES(?,?,?,?,?,?,?,?)')
          .run(sha, name, kind, owner, permission, actor, bytes, JSON.stringify(paragraphs));
        if (result.changes) audit('imported', actor, sha, { owner, permission });
        return { sha, duplicate: !result.changes, paragraphs: paragraphs.filter(Boolean).length };
      });
    },
    list() {
      return db.prepare(`SELECT i.sha, i.name, i.kind, i.owner, i.permission, i.imported_by,
        (SELECT count(*) FROM review r WHERE r.doc=i.sha AND r.active=1) AS approved
        FROM intake i ORDER BY i.rowid DESC`).all();
    },
    document(sha, offset = 0, needle = '') {
      const row = getSource(sha);
      const paragraphsAll = JSON.parse(row.paragraphs);
      const suggestedReview = publicCard(row, paragraphsAll);
      const all = paragraphsAll.map((quote, i) => ({ paragraph: i + 1, quote }))
        .filter(part => part.quote && (!needle || part.quote.toLowerCase().includes(needle.toLowerCase())));
      const { paragraphs, ...source } = row;
      return { ...source, suggestedReview, count: all.length, paragraphs: all.slice(offset, offset + 30)
        .map(part => ({ ...part, quote: part.quote.slice(0, 2500), tooLong: part.quote.length > 2500, digest: digest(part.quote) })),
      review: revisions().filter(item => item.doc === sha).map(item => ({ ...JSON.parse(item.data), active: Boolean(item.active) })) };
    },
    approve(body, actor) {
      const source = getSource(body?.sha);
      const number = body.paragraph;
      const paragraphs = JSON.parse(source.paragraphs);
      const candidate = publicCard(source, paragraphs);
      if (candidate?.retired) reject('Phiếu này đã được thay bằng bản Công báo.', 409);
      if (candidate && number !== candidate.paragraph) reject('Chỉ duyệt được đoạn nguyên văn của phiếu nguồn công khai.', 409);
      const quote = Number.isInteger(number) && number >= 1 ? paragraphs[number - 1] : undefined;
      if (typeof quote !== 'string' || quote.length < 12 || quote.length > 2500 ||
          digest(quote) !== body.digest || body.confirmed !== true) reject('Đoạn đã đổi hoặc chưa xác nhận duyệt.', 409);
      const scope = body.scope;
      if (!Array.isArray(scope) || scope.length !== 4 || !scope.every((value, i) => Object.hasOwn(labels[i], value))) {
        reject('Chọn đủ quốc gia, loại quyền, thủ tục và nội dung.');
      }
      if (candidate && scope.join('/') !== candidate.scope.join('/')) reject('Phạm vi khác bản chụp của phiếu nguồn.', 409);
      if (!fieldValues[scope[3]].has(body.value) && !['expired', 'verify-office-record'].includes(body.value)) {
        reject('Kết luận không phù hợp loại nội dung đã chọn.');
      }
      const issuer = bounded(body.issuer, 50);
      if (!issuerCode.test(issuer)) reject('Mã đơn vị xác nhận chỉ gồm chữ thường, số hoặc dấu gạch nối.');
      const statement = bounded(body.statement, 1600, 12);
      const clientText = body.clientText ? bounded(body.clientText, 1600, 12) : null;
      const date = body.date || null;
      const supersedes = body.supersedes ? [bounded(body.supersedes, 80)] : [];
      storedFile(source.sha);
      return tx(() => {
        const current = revisions();
        const id = 'r-' + source.sha.slice(0, 18) + '-' + number;
        const existing = current.find(item => item.id === id);
        if (existing?.active) reject('Đoạn đã duyệt. Thu hồi trước khi duyệt lại.', 409);
        const row = { id, scope, statement, clientText, value: body.value, issuer, date, supersedes, reviewed: true,
          reviewer: actor, reviewedAt: Date.now(), kind: source.kind, title: source.name, quote, paragraph: number,
          file: source.sha + (source.kind === 'word' ? '.docx' : '.eml'), quoteSha256: digest(quote), sha256: source.sha,
          simulated: false, layers: ['library'], ...(candidate ? { origin: candidate.origin,
            locator: candidate.locator + (candidate.page ? ' · trang PDF ' + candidate.page : '') } : {}) };
        const checked = current.filter(item => item.active && item.id !== id).map(item => JSON.parse(item.data));
        try { createIndex({ schema: 1, simulation: false, rows: [...checked, row] }, { privateLibrary: true }); }
        catch { reject('Ngày hoặc quan hệ thay thế không hợp lệ. Kiểm tra cùng đơn vị và phạm vi.'); }
        db.prepare('INSERT INTO review VALUES(?,?,?,1) ON CONFLICT(id) DO UPDATE SET data=excluded.data,active=1')
          .run(id, source.sha, JSON.stringify(row));
        audit('approved', actor, id, row);
        return { id };
      });
    },
    withdraw(id, actor) {
      return tx(() => {
        const rows = revisions();
        if (rows.some(item => item.active && JSON.parse(item.data).supersedes.includes(id))) {
          reject('Thu hồi hướng dẫn thay thế đang dùng trước khi thu hồi đoạn này.', 409);
        }
        if (!db.prepare('UPDATE review SET active=0 WHERE id=? AND active=1').run(id).changes) reject('Đoạn đã thu hồi hoặc không tồn tại.', 404);
        audit('withdrawn', actor, id);
        return { withdrawn: true };
      });
    },
    file(id) {
      const current = publish().index.source(id);
      if (!current) reject('Nguồn chưa được duyệt hoặc đã thu hồi.', 404);
      return storedFile(current.sha256);
    },
  };
}
