import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { CaseError } from '../copilot/m3/workflow.mjs';

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
    ) STRICT;`);
  const list = db.prepare('SELECT id,reference,title,version,updated_at AS updatedAt FROM patent_cases WHERE group_id=? ORDER BY updated_at DESC LIMIT 30');
  const read = db.prepare('SELECT content FROM patent_cases WHERE id=? AND group_id=?');
  const insert = db.prepare('INSERT INTO patent_cases VALUES(?,?,?,?,?,?,?)');
  const update = db.prepare('UPDATE patent_cases SET title=?,version=?,updated_at=?,content=? WHERE id=? AND group_id=? AND version=?');
  const receiptCount = db.prepare('SELECT count(*) AS count FROM patent_model_receipts');
  const insertReceipt = db.prepare('INSERT INTO patent_model_receipts VALUES(?,?,?,?,?)');
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
      if (list.all(matter.group).length >= 20) throw new CaseError('Nhóm đã đạt 20 hồ sơ sáng chế trong pilot.', 409);
      try { insert.run(matter.id, matter.group, matter.reference, matter.title, matter.version, matter.updatedAt, JSON.stringify(matter)); }
      catch (error) {
        if (String(error.message).includes('UNIQUE')) throw new CaseError('Mã hồ sơ sáng chế đã tồn tại trong nhóm.', 409);
        throw error;
      }
      return matter;
    },
    save(matter) {
      const before = matter.version;
      matter.version++;
      matter.updatedAt = new Date().toISOString();
      if (!update.run(matter.title, matter.version, matter.updatedAt, JSON.stringify(matter), matter.id, matter.group, before).changes) {
        throw new CaseError('Hồ sơ đã đổi ở phiên khác. Mở lại trước khi lưu.', 409);
      }
      return matter;
    },
    close: () => db.close()
  };
}
