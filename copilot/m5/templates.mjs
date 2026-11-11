import { digest } from '../../sot/bundle.mjs';
import { bounded, CaseError } from '../m3/workflow.mjs';

const initial = {
  version: 1, title: 'Phiếu rà soát phản hồi thẩm định',
  text: 'Đối chiếu đoạn yêu cầu trong thông báo. Xác nhận nội dung sửa theo chỉ dẫn. Kiểm danh mục tài liệu kèm theo trước khi duyệt.',
  scope: 'office_response', provenance: 'Mẫu nội bộ mô phỏng M5'
};
const seed = { ...initial, digest: digest(initial) };

export function createTemplates(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS m5_template_versions (
      team TEXT NOT NULL, version INTEGER NOT NULL, base TEXT NOT NULL,
      author TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (team, version)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS m5_template_events (
      sequence INTEGER PRIMARY KEY, team TEXT NOT NULL, version INTEGER NOT NULL,
      action TEXT NOT NULL, actor TEXT NOT NULL, at TEXT NOT NULL
    ) STRICT;
  `);
  const get = db.prepare('SELECT * FROM m5_template_versions WHERE team=? AND version=?');
  const list = db.prepare('SELECT * FROM m5_template_versions WHERE team=? ORDER BY version DESC LIMIT 40');
  const events = db.prepare('SELECT version, action, actor, at FROM m5_template_events WHERE team=? ORDER BY sequence DESC');
  const latest = db.prepare('SELECT version FROM m5_template_events WHERE team=? ORDER BY sequence DESC LIMIT 1');
  const add = db.prepare('INSERT INTO m5_template_versions VALUES (?,?,?,?,?)');
  const record = db.prepare('INSERT INTO m5_template_events(team,version,action,actor,at) VALUES (?,?,?,?,?)');
  const value = (group, version) => version === 1 ? seed : JSON.parse(get.get(group, version).data);
  const current = group => value(group, latest.get(group)?.version ?? 1);
  const check = (body, actual) => {
    if (body?.base !== actual.digest) throw new CaseError('Phiên bản đang dùng đã đổi. Mở lại danh mục để so sánh.', 409);
  };
  function transaction(action) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = action();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  return {
    current,
    view(actor) {
      const group = actor.group;
      const history = events.all(group);
      const active = current(group);
      return { current: active, history, versions: [...list.all(group).map(row => ({
        ...JSON.parse(row.data), base: row.base, author: row.author,
        status: row.version === active.version ? 'current' : history.some(event => event.version === row.version) ? 'superseded' : 'staged'
      })), { ...seed, status: active.version === 1 ? 'current' : 'superseded' }] };
    },
    stage(actor, body) {
      return transaction(() => {
        const active = current(actor.group);
        check(body, active);
        const title = bounded(body?.title, 100, 'Tên mẫu');
        const text = bounded(body?.text, 800, 'Nội dung mẫu');
        if (title === active.title && text === active.text) throw new CaseError('Nội dung trùng phiên bản đang dùng.', 409);
        const rows = list.all(actor.group);
        if (rows.length >= 40) throw new CaseError('Danh mục mô phỏng đã đạt 40 phiên bản.', 409);
        if (rows.some(row => row.base === active.digest && JSON.parse(row.data).title === title &&
            JSON.parse(row.data).text === text)) throw new CaseError('Đã có đề xuất giống nội dung này.', 409);
        const item = { ...initial, version: (rows[0]?.version ?? 1) + 1, title, text };
        const saved = { ...item, digest: digest(item) };
        add.run(actor.group, item.version, active.digest, actor.name, JSON.stringify(saved));
        return saved;
      });
    },
    change(actor, action, body) {
      if (actor.role !== 'reviewer') throw new CaseError('Cần quyền luật sư để công bố hoặc khôi phục mẫu.', 403);
      return transaction(() => {
        const active = current(actor.group);
        check(body, active);
        const version = body?.version;
        if (!Number.isInteger(version) || version < 1 || version === active.version) {
          throw new CaseError('Chọn một phiên bản khác bản đang dùng.', 409);
        }
        const row = get.get(actor.group, version);
        if (version !== 1 && !row) throw new CaseError('Không tìm thấy phiên bản.', 404);
        const item = value(actor.group, version);
        if (item.digest !== body.digest) throw new CaseError('Dấu kiểm phiên bản không khớp.', 409);
        const published = version === 1 || events.all(actor.group).some(event => event.version === version);
        if (action === 'publish' && (published || row.author === actor.name || row.base !== active.digest)) {
          throw new CaseError('Cần đề xuất từ người khác, so với đúng bản đang dùng và chưa từng công bố.', 409);
        }
        if (action === 'rollback' && !published) throw new CaseError('Chỉ khôi phục bản từng được công bố.', 409);
        record.run(actor.group, version, action, actor.name, new Date().toISOString());
        return item;
      });
    }
  };
}
