import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync, openSync, closeSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { bounded, CaseError, checkedBasis, draftingFacts, editSections, hash, ids, needsReview, pick, renderRelease, source } from './workflow.mjs';
import { createTemplates } from '../m5/templates.mjs';

const now = () => new Date().toISOString();
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const sectionContent = value => value && { text: value.text, sources: value.sources };

export function openCaseStore(path, m5 = false) {
  if (!path) throw new Error('M3 cần đường dẫn lưu hồ sơ riêng.');
  const file = resolve(path);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  closeSync(openSync(file, 'a', 0o600));
  chmodSync(file, 0o600);
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA busy_timeout = 4000;
    CREATE TABLE IF NOT EXISTS matters (
      id TEXT PRIMARY KEY, version INTEGER NOT NULL, reference TEXT NOT NULL COLLATE NOCASE UNIQUE,
      title TEXT NOT NULL, updated TEXT NOT NULL, content TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS notice_files (id TEXT PRIMARY KEY, bytes BLOB NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS word_releases (
      id TEXT NOT NULL, number INTEGER NOT NULL, sha TEXT NOT NULL, bytes BLOB NOT NULL,
      PRIMARY KEY(id, number)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS word_layout_releases (
      id TEXT NOT NULL, number INTEGER NOT NULL, layout TEXT NOT NULL, sha TEXT NOT NULL, bytes BLOB NOT NULL,
      PRIMARY KEY(id, number, layout)
    ) STRICT;
  `);
  const insert = db.prepare('INSERT INTO matters VALUES (?, ?, ?, ?, ?, ?)');
  const lookup = db.prepare('SELECT content FROM matters WHERE id = ?');
  const update = db.prepare('UPDATE matters SET version = ?, updated = ?, content = ? WHERE id = ? AND version = ?');
  const list = db.prepare(`SELECT id, reference, title, updated FROM matters
    WHERE json_extract(content, '$.group') IS NULL ORDER BY updated DESC LIMIT 100`);
  const groupList = db.prepare(`SELECT id, json_extract(content, '$.reference') AS reference, title, updated FROM matters
    WHERE json_extract(content, '$.group') = ? ORDER BY updated DESC LIMIT 100`);
  const byRef = db.prepare('SELECT id FROM matters WHERE reference = ?');
  const addPDF = db.prepare('INSERT INTO notice_files VALUES (?, ?)');
  const getPDF = db.prepare('SELECT bytes FROM notice_files WHERE id = ?');
  const addWord = db.prepare('INSERT OR IGNORE INTO word_releases VALUES (?, ?, ?, ?)');
  const getWord = db.prepare('SELECT bytes, sha FROM word_releases WHERE id = ? AND number = ?');
  const addLayout = db.prepare('INSERT OR IGNORE INTO word_layout_releases VALUES (?, ?, ?, ?, ?)');
  const getLayout = db.prepare('SELECT bytes, sha FROM word_layout_releases WHERE id = ? AND number = ? AND layout = ?');
  const word = (id, number, layout) => layout === 'legacy' ? getWord.get(id, number) : getLayout.get(id, number, layout);

  return {
    list: group => group ? groupList.all(group) : list.all(),
    templates: m5 ? createTemplates(db) : null,
    read(id) {
      const row = lookup.get(id);
      if (!row) throw new CaseError('Không tìm thấy hồ sơ.', 404);
      return JSON.parse(row.content);
    },
    create(matter, pdf) {
      const storageReference = matter.group ? matter.group + ':' + matter.reference : matter.reference;
      if (pdf) db.exec('BEGIN IMMEDIATE');
      try {
        insert.run(matter.id, matter.version, storageReference, matter.title, matter.updated, JSON.stringify(matter));
        if (pdf) {
          addPDF.run(matter.id, pdf);
          db.exec('COMMIT');
        }
      } catch (error) {
        if (pdf) db.exec('ROLLBACK');
        if (byRef.get(storageReference)) throw new CaseError('Mã hồ sơ đã có. Hãy mở hồ sơ đã lưu.', 409);
        throw error;
      }
      return matter;
    },
    pdf: id => getPDF.get(id)?.bytes,
    word,
    saveWord(id, number, layout, bytes) {
      if (layout === 'legacy') addWord.run(id, number, hash(bytes), bytes);
      else addLayout.run(id, number, layout, hash(bytes), bytes);
      return word(id, number, layout);
    },
    save(matter) {
      const before = matter.version;
      matter.version += 1;
      matter.updated = now();
      if (!update.run(matter.version, matter.updated, JSON.stringify(matter), matter.id, before).changes) {
        throw new CaseError('Hồ sơ đã được cập nhật ở phiên khác. Mở lại để đối chiếu trước khi lưu.', 409);
      }
      return matter;
    },
    close: () => db.close()
  };
}

export function createCaseWorkflow(store, review, model) {
  function read(id, version) {
    const matter = store.read(id);
    if (matter.version !== version) throw new CaseError('Hồ sơ đã thay đổi. Mở lại bản mới nhất.', 409);
    return matter;
  }

  function basisCurrent(matter) {
    if (!equal(matter.basis, checkedBasis(review, matter.facts))) {
      throw new CaseError('Căn cứ đã đổi. Cần rà soát hồ sơ với bộ nguồn mới trước khi tiếp tục.', 409);
    }
    if (templateChanged(matter)) {
      throw new CaseError('Mẫu rà soát đã đổi. Tra và lưu lại căn cứ trước khi tiếp tục duyệt hoặc soạn.', 409);
    }
  }

  function sourceChanged(matter) {
    try {
      return !equal(matter.basis, checkedBasis(review, matter.facts));
    } catch (error) {
      if (error instanceof CaseError) return true;
      throw error;
    }
  }

  const templateChanged = matter => Boolean(matter.research &&
    store.templates?.current(matter.group).digest !== matter.research.template.digest);

  function appendDraft(matter, patch, type, run = null) {
    if (matter.drafts.length >= 40) throw new CaseError('Hồ sơ đã đạt giới hạn 40 bản nháp của pilot.', 409);
    const previous = matter.drafts.at(-1);
    matter.drafts.push({
      number: (previous?.number ?? 0) + 1, parent: previous?.number ?? null, at: now(), type, run,
      sections: { ...previous?.sections, ...patch }
    });
    return store.save(matter);
  }

  return {
    list: store.list,
    read: id => store.read(id),
    sourceChanged,
    templateChanged,
    create(body, pdf, group, research) {
      if (body?.anonymized !== true) throw new CaseError('Chỉ dùng nguồn mô phỏng hoặc đã ẩn danh và được phép.');
      const reference = bounded(body.reference, 48, 'Mã hồ sơ').toUpperCase();
      if (!/^[A-Z0-9][A-Z0-9./_-]*$/.test(reference)) throw new CaseError('Mã hồ sơ chỉ dùng chữ Latin, số, dấu chấm, gạch hoặc gạch chéo.');
      const facts = {
        asOf: body.asOf, receivedOn: body.receivedOn, pendingAtCutover: body.pendingAtCutover ?? null
      };
      if (research) matchResearch(facts, research);
      const timestamp = now();
      return store.create({
        id: randomUUID(), version: 1, reference, title: bounded(body.title, 100, 'Tên nhãn hiệu'),
        updated: timestamp, facts, basis: checkedBasis(review, facts),
        ...(group ? { group } : {}),
        ...(research ? { research: { ...research, savedAt: timestamp } } : {}),
        ...(pdf ? { document: pdf.document } : {}),
        sources: [source('notice', (pdf?.notice ?? body.notice)?.label, (pdf?.notice ?? body.notice)?.text),
          source('instructions', body.instructions?.label, body.instructions?.text)],
        drafts: [], approved: {}, releases: []
      }, pdf?.bytes);
    },
    saveResearch(id, version, research) {
      const matter = read(id, version);
      matchResearch(matter.facts, research);
      if (matter.research?.proofId === research.proofId) return matter;
      const basis = checkedBasis(review, matter.facts);
      if (!equal(matter.basis, basis) ||
          (matter.research && matter.research.template.digest !== research.template.digest)) matter.approved = {};
      matter.research = { ...research, savedAt: now() };
      matter.basis = basis;
      return store.save(matter);
    },
    addSource(id, body) {
      const matter = read(id, body?.version);
      if (matter.sources.length >= 6) throw new CaseError('Hồ sơ đã đạt giới hạn 6 nguồn.', 409);
      const item = source('update-' + (matter.sources.length - 1), body.label, body.text);
      if (matter.sources.some(existing => existing.sha256 === item.sha256)) throw new CaseError('Nội dung nguồn này đã lưu.', 409);
      matter.sources.push(item);
      return store.save(matter);
    },
    async propose(id, body, authorize = () => {}) {
      const matter = read(id, body?.version);
      basisCurrent(matter);
      const base = matter.drafts.at(-1)?.sections;
      const targets = base ? pick(body.targets, 'phần cần sửa') : ids;
      const selected = body.sources;
      if (!Array.isArray(selected) || !selected.includes('notice') || !selected.includes('instructions') ||
          new Set(selected).size !== selected.length || selected.length > 4 ||
          selected.some(sourceId => !matter.sources.some(item => item.id === sourceId))) {
        throw new CaseError('Chọn thông báo, chỉ dẫn gốc và tối đa hai nguồn bổ sung đã lưu.');
      }
      const documents = matter.sources.filter(item => selected.includes(item.id));
      if (documents.reduce((total, item) => total + item.text.length, 0) > 3300) {
        throw new CaseError('Các nguồn đã chọn vượt tổng giới hạn 3.300 ký tự cho một lượt soạn.');
      }
      const result = await model({
        facts: draftingFacts(matter), fromPDF: Boolean(matter.document),
        basis: matter.basis, sources: documents,
        base, targets,
        instruction: base || body.instruction
          ? bounded(body.instruction, 400, 'Yêu cầu soạn hoặc sửa')
          : 'Soạn bản phản hồi đầu tiên theo thông báo và chỉ dẫn đã chọn.'
      });
      authorize();
      basisCurrent(matter);
      return appendDraft(matter, result.patch, base ? 'model-revision' : 'model-draft',
        { ...result.run, selectedSources: documents.map(item => item.id) });
    },
    edit(id, body) {
      const matter = read(id, body?.version);
      basisCurrent(matter);
      const base = matter.drafts.at(-1)?.sections;
      if (!base) throw new CaseError('Tạo bản nháp trước khi sửa.');
      const patch = editSections(base, body.edits);
      if (body.sources !== undefined) {
        if (!body.sources || typeof body.sources !== 'object' || Array.isArray(body.sources) ||
            Object.keys(body.sources).some(key => !Object.hasOwn(patch, key))) throw new CaseError('Nguồn phần sửa chưa hợp lệ.');
        for (const [key, selected] of Object.entries(body.sources)) {
          if (!Array.isArray(selected) || selected.length < 1 || selected.length > 4 || new Set(selected).size !== selected.length ||
              selected.some(id => !matter.sources.some(item => item.id === id))) throw new CaseError('Chọn từ 1 đến 4 nguồn đã lưu cho phần sửa.');
          patch[key].sources = selected;
        }
      }
      return appendDraft(matter, patch, 'manual');
    },
    keep(id, body) {
      const matter = read(id, body?.version);
      basisCurrent(matter);
      const draft = matter.drafts.at(-1);
      const targets = pick(body.targets, 'phần muốn giữ bản đã duyệt');
      const patch = Object.fromEntries(targets.map(key => [key, sectionContent(matter.approved[key])]));
      if (!draft || targets.some(key => !patch[key] || equal(patch[key], draft.sections[key]))) {
        throw new CaseError('Chỉ giữ bản cũ ở phần đã duyệt và đang có thay đổi.', 409);
      }
      return appendDraft(matter, patch, 'keep-approved');
    },
    approve(id, body, actor) {
      const matter = read(id, body?.version);
      basisCurrent(matter);
      const draft = matter.drafts.at(-1);
      if (!draft) throw new CaseError('Tạo bản nháp trước khi duyệt.');
      const targets = pick(body.targets, 'phần muốn duyệt');
      if (targets.some(key => needsReview(draft.sections[key].text))) {
        throw new CaseError('Hoàn tất phần còn chờ luật sư xác nhận trước khi duyệt.', 422);
      }
      const hasSources = section => Array.isArray(section?.sources) && section.sources.length >= 1 && section.sources.length <= 4 &&
        new Set(section.sources).size === section.sources.length && section.sources.every(id => matter.sources.some(item => item.id === id));
      if (targets.some(key => !hasSources(draft.sections[key])) || ids.some(key =>
        !targets.includes(key) && matter.approved[key] && !hasSources(matter.approved[key]))) {
        throw new CaseError('Mỗi phần được duyệt cần từ 1 đến 4 nguồn hồ sơ còn tồn tại.', 422);
      }
      if (targets.some(key => equal(sectionContent(matter.approved[key]), draft.sections[key]))) {
        throw new CaseError('Chỉ chọn phần mới hoặc có thay đổi để duyệt.', 409);
      }
      const at = now();
      const approvedBy = actor ? { name: actor.name, group: actor.group, role: actor.role } : null;
      for (const key of targets) matter.approved[key] = { ...draft.sections[key], draft: draft.number, at,
        ...(approvedBy ? { approvedBy } : {}) };
      if (ids.every(key => Object.hasOwn(matter.approved, key))) {
        const number = matter.releases.length + 1;
        const markdown = renderRelease(matter, matter.approved, number);
        const selected = new Set(ids.flatMap(key => matter.approved[key].sources));
        matter.releases.push({
          number, at, markdown, sha256: hash(markdown), sections: structuredClone(matter.approved), basis: matter.basis,
          ...(approvedBy ? { approvedBy } : {}),
          ...(matter.research ? { research: matter.research } : {}),
          sources: matter.sources.filter(item => selected.has(item.id)).map(({ id, label, sha256 }) => ({
            id, label, sha256,
            ...(id === 'notice' && matter.document ? { pdfSha256: matter.document.sha256, anchors: matter.document.anchors } : {})
          }))
        });
      }
      return store.save(matter);
    }
  };
}

function matchResearch(facts, research) {
  if (Object.entries(facts).some(([key, value]) => research.fields[key] !== value)) {
    throw new CaseError('Ngày và tình trạng trong căn cứ phải khớp hồ sơ. Tra lại theo dữ kiện của hồ sơ.', 409);
  }
}
