import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { CaseError, hash } from '../copilot/m3/workflow.mjs';

const maxAttachmentBytes = 5 * 1024 * 1024;
const maxDatabaseBytes = 10 * 1024 * 1024;
const maxMatterBytes = 3 * 1024 * 1024;

function caseContent(matter) {
  const content = JSON.stringify(matter);
  if (Buffer.byteLength(content) > maxMatterBytes) {
    throw new CaseError('Hồ sơ đã đạt giới hạn lưu nội dung và lịch sử của pilot.', 413);
  }
  return content;
}

export function openPatentStore(path) {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA busy_timeout=4000;
    CREATE TABLE IF NOT EXISTS patent_cases (
      id TEXT PRIMARY KEY, group_id TEXT NOT NULL, reference TEXT NOT NULL,
      title TEXT NOT NULL, version INTEGER NOT NULL, updated_at TEXT NOT NULL, content TEXT NOT NULL,
      UNIQUE(group_id,reference)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS patent_model_receipts (
      id TEXT PRIMARY KEY, case_id TEXT NOT NULL, group_id TEXT NOT NULL, at TEXT NOT NULL, content TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS patent_pdf_attachments (
      id TEXT PRIMARY KEY, case_id TEXT NOT NULL, group_id TEXT NOT NULL,
      sha256 TEXT NOT NULL, page_count INTEGER NOT NULL, bytes BLOB NOT NULL,
      UNIQUE(case_id,group_id,sha256)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS patent_word_artifacts (
      case_id TEXT NOT NULL, group_id TEXT NOT NULL, release_number INTEGER NOT NULL,
      sha256 TEXT NOT NULL, bytes BLOB NOT NULL,
      PRIMARY KEY(case_id,group_id,release_number)
    ) STRICT;`);
  const list = db.prepare('SELECT id,reference,title,version,updated_at AS updatedAt FROM patent_cases WHERE group_id=? ORDER BY updated_at DESC LIMIT 30');
  const read = db.prepare('SELECT content FROM patent_cases WHERE id=? AND group_id=?');
  const insert = db.prepare('INSERT INTO patent_cases VALUES(?,?,?,?,?,?,?)');
  const update = db.prepare('UPDATE patent_cases SET title=?,version=?,updated_at=?,content=? WHERE id=? AND group_id=? AND version=?');
  const receiptCount = db.prepare('SELECT count(*) AS count FROM patent_model_receipts');
  const insertReceipt = db.prepare('INSERT INTO patent_model_receipts VALUES(?,?,?,?,?)');
  const attachmentByHash = db.prepare('SELECT id FROM patent_pdf_attachments WHERE case_id=? AND group_id=? AND sha256=?');
  const attachmentById = db.prepare('SELECT bytes,sha256,page_count AS pageCount FROM patent_pdf_attachments WHERE id=? AND case_id=? AND group_id=?');
  const attachmentCount = db.prepare('SELECT count(*) AS count FROM patent_pdf_attachments WHERE case_id=? AND group_id=?');
  const insertAttachment = db.prepare('INSERT INTO patent_pdf_attachments VALUES(?,?,?,?,?,?)');
  const insertWord = db.prepare('INSERT INTO patent_word_artifacts VALUES(?,?,?,?,?)');
  const readWord = db.prepare('SELECT bytes,sha256 FROM patent_word_artifacts WHERE case_id=? AND group_id=? AND release_number=?');
  const attachmentUsage = db.prepare(`SELECT
    COALESCE((SELECT sum(length(bytes)) FROM patent_pdf_attachments),0) +
    COALESCE((SELECT sum(length(bytes)) FROM patent_word_artifacts),0) AS bytes`);
  const pageCount = db.prepare('PRAGMA page_count');
  const pageSize = db.prepare('PRAGMA page_size').get().page_size;
  const requireCapacity = extra => {
    if (attachmentUsage.get().bytes + extra > maxAttachmentBytes) {
      throw new CaseError('Kho PDF và Word pilot đã đạt giới hạn 5 MiB. Bản đang lưu vẫn giữ nguyên.', 413);
    }
  };
  function writeCase(change) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = change();
      if (pageCount.get().page_count * pageSize > maxDatabaseBytes) {
        throw new CaseError('Kho hồ sơ pilot gần đầy. Thay đổi này chưa được lưu.', 413);
      }
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  return {
    ensureModelReceiptCapacity() {
      if (receiptCount.get().count >= 500) throw new CaseError('Nhật ký AI đã đạt giới hạn 500 lượt của pilot. Lưu trữ nhật ký trước khi gọi thêm.', 409);
    },
    recordModelReceipt(caseId, group, receipt) {
      const content = JSON.stringify(receipt);
      if (Buffer.byteLength(content) > 32768) throw new CaseError('Biên nhận AI vượt giới hạn lưu an toàn.', 503);
      insertReceipt.run(randomUUID(), caseId, group, new Date().toISOString(), content);
    },
    list: group => list.all(group),
    read(id, group) {
      const item = read.get(id, group);
      if (!item) throw new CaseError('Không tìm thấy hồ sơ sáng chế.', 404);
      return JSON.parse(item.content);
    },
    create(matter) {
      const content = caseContent(matter);
      try {
        return writeCase(() => {
          if (list.all(matter.group).length >= 20) throw new CaseError('Nhóm đã đạt 20 hồ sơ sáng chế trong pilot.', 409);
          insert.run(matter.id, matter.group, matter.reference, matter.title, matter.version, matter.updatedAt, content);
          return matter;
        });
      } catch (error) {
        if (String(error.message).includes('UNIQUE')) throw new CaseError('Mã hồ sơ sáng chế đã tồn tại trong nhóm.', 409);
        throw error;
      }
    },
    findAttachment(caseId, group, sha256) { return attachmentByHash.get(caseId, group, sha256)?.id ?? null; },
    attachment(id, caseId, group) {
      const stored = attachmentById.get(id, caseId, group);
      if (!stored) throw new CaseError('Không tìm thấy PDF của hồ sơ.', 404);
      const bytes = Buffer.from(stored.bytes);
      if (hash(bytes) !== stored.sha256) throw new CaseError('Dấu kiểm PDF đã lưu không khớp.', 409);
      return { bytes, sha256: stored.sha256, pageCount: stored.pageCount };
    },
    wordArtifact(caseId, group, release) {
      const stored = readWord.get(caseId, group, release.number);
      if (!stored || stored.sha256 !== release.artifact?.sha256 || stored.bytes.byteLength !== release.artifact?.byteLength) {
        throw new CaseError('Thiếu bản Word gốc hoặc dấu kiểm của bản đã duyệt không khớp.', 409);
      }
      const bytes = Buffer.from(stored.bytes);
      if (hash(bytes) !== stored.sha256) throw new CaseError('Dấu kiểm bản Word đã lưu không khớp.', 409);
      return bytes;
    },
    save(matter, { attachment, artifact } = {}) {
      const before = matter.version;
      const saved = { ...matter, version: before + 1, updatedAt: new Date().toISOString() };
      const content = caseContent(saved);
      return writeCase(() => {
        if (!update.run(saved.title, saved.version, saved.updatedAt, content, saved.id, saved.group, before).changes) {
          throw new CaseError('Hồ sơ đã đổi ở phiên khác. Mở lại trước khi lưu.', 409);
        }
        const extra = (attachment?.bytes.length ?? 0) + (artifact?.bytes.length ?? 0);
        if (extra) requireCapacity(extra);
        if (attachment) {
          if (attachmentCount.get(saved.id, saved.group).count >= 6) throw new CaseError('Hồ sơ đã lưu 6 bản PDF gốc trong pilot.', 413);
          insertAttachment.run(attachment.id, saved.id, saved.group, attachment.sha256, attachment.pageCount, attachment.bytes);
        }
        if (artifact) insertWord.run(saved.id, saved.group, artifact.number, artifact.sha256, artifact.bytes);
        return saved;
      });
    },
    close: () => db.close()
  };
}
