import { DatabaseSync } from 'node:sqlite';
import { CaseError } from '../copilot/m3/workflow.mjs';

export function openPatentStore(path) {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA busy_timeout=4000;
    CREATE TABLE IF NOT EXISTS patent_cases (
      id TEXT PRIMARY KEY, group_id TEXT NOT NULL, reference TEXT NOT NULL,
      title TEXT NOT NULL, version INTEGER NOT NULL, updated_at TEXT NOT NULL, content TEXT NOT NULL,
      UNIQUE(group_id,reference)
    ) STRICT;`);
  const list = db.prepare('SELECT id,reference,title,version,updated_at AS updatedAt FROM patent_cases WHERE group_id=? ORDER BY updated_at DESC LIMIT 30');
  const read = db.prepare('SELECT content FROM patent_cases WHERE id=? AND group_id=?');
  const insert = db.prepare('INSERT INTO patent_cases VALUES(?,?,?,?,?,?,?)');
  const update = db.prepare('UPDATE patent_cases SET title=?,version=?,updated_at=?,content=? WHERE id=? AND group_id=? AND version=?');
  return {
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
