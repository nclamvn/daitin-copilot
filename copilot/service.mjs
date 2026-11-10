import { createModelRouter } from './model-router.mjs';
import { applyIntake, intakeContract } from './intake.mjs';
export { IntakeError } from './intake.mjs';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const here = file => new URL(file, import.meta.url);
const fingerprint = data => createHash('sha256').update(data).digest('hex');
const json = value => JSON.parse(value);
const fold = value => value.normalize('NFD').toLowerCase().replace(/\p{M}/gu, '')
  .replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, ' ').trim();
const text = (url, key) => (url.searchParams.get(key) ?? '').trim();
const countMatches = query => [...new Set(fold(query).split(' ').filter(Boolean))];
const proofFile = doc => here((doc.storage === 'mvp' ? '../corpus/snapshots/' : './snapshots/') + doc.file);
const html = 'text/html; charset=utf-8';
const js = 'application/javascript; charset=utf-8';
const css = 'text/css; charset=utf-8';
const assets = new Map([
  ['/copilot', ['desk.html', html]], ['/copilot/', ['desk.html', html]],
  ['/copilot/desk.mjs', ['desk.mjs', js]], ['/copilot/desk.css', ['desk.css', css]]
]);

export class CopilotInputError extends Error {}
const invalid = message => { throw new CopilotInputError(message); };

function excerpt(body, query) {
  const lines = body.split('\n').map(line => line.trim()).filter(Boolean);
  const match = lines.findIndex(line => fold(line).includes(fold(query)));
  const start = match >= 0 ? Math.max(0, match - 1) : 0;
  return lines.slice(start, start + 5).join(' ').replace(/\s+/g, ' ').slice(0, 510);
}

export function createCopilot(catalog, resolveProcedure) {
  if (catalog.dataStatus !== 'preview') throw new Error('Bàn làm việc M1 cần bản SOT ứng viên.');
  const receipt = json(readFileSync(here('evidence.receipt.json')));
  if (receipt.parentSotDigest !== catalog.releaseDigest ||
      receipt.indexSha256 !== fingerprint(readFileSync(here('evidence.sqlite')))) {
    throw new Error('Dấu kiểm chỉ mục copilot sai hoặc thuộc bản SOT khác.');
  }
  const db = new DatabaseSync(fileURLToPath(here('evidence.sqlite')), { readOnly: true });
  const report = json(db.prepare("SELECT value FROM metadata WHERE key='report'").get().value);
  if (report.parentSotDigest !== catalog.releaseDigest) throw new Error('Bản SOT đã đổi. Dựng lại kho copilot.');
  const inputs = [readFileSync(here('sources.json')), readFileSync(here('workflows.json')), Buffer.from(catalog.releaseDigest)];
  const inputDigest = fingerprint(Buffer.concat([inputs[0], Buffer.from([0]), inputs[1], Buffer.from([0]), inputs[2]]));
  if (inputDigest !== report.inputDigest || inputDigest !== receipt.inputDigest) {
    throw new Error('Đầu vào kho copilot đã đổi. Dựng lại chỉ mục.');
  }
  const sources = new Map(db.prepare('SELECT id, manifest FROM source ORDER BY id').all()
    .map(row => [row.id, json(row.manifest)]));
  const canonicalSources = json(inputs[0]);
  for (const [id, source] of sources) {
    if (Object.keys(source).length !== Object.keys(canonicalSources[id] ?? {}).length ||
        Object.keys(source).some(key => source[key] !== canonicalSources[id][key]) ||
        fingerprint(readFileSync(proofFile(source))) !== source.sha256) throw new Error('Sai bản nguồn ' + id);
  }
  if (sources.size !== Object.keys(canonicalSources).length) throw new Error('Thiếu bản nguồn trong chỉ mục.');
  const claims = new Map(db.prepare('SELECT id,record FROM claim').all().map(row => [row.id, json(row.record)]));
  const articleQuery = db.prepare(`
    SELECT a.source, CAST(a.page AS INTEGER) AS page, p.text AS body, bm25(law_find) AS score
    FROM law_find a JOIN page p ON a.source=p.source AND a.page=p.page
    WHERE law_find MATCH ? AND (? = '' OR a.source=?) ORDER BY score,a.source,a.page LIMIT 25
  `);
  const niceQuery = db.prepare(`
    SELECT n.* FROM nice_find f JOIN nice n ON n.edition=f.edition AND n.code=f.code
    WHERE nice_find MATCH ? AND n.edition=? AND (?=0 OR n.class=?) ORDER BY bm25(nice_find),n.code LIMIT 30
  `);
  const niceExact = db.prepare('SELECT * FROM nice WHERE edition=? AND code=? AND (?=0 OR class=?)');
  const byApplication = db.prepare('SELECT * FROM event WHERE application=? ORDER BY transferred,row');
  const evidence = (id, page) => ({
    source: id, sourceLabel: sources.get(id).label, sourceRole: sources.get(id).role, page,
    original: sources.get(id).url + '#page=' + page,
    local: '/copilot/source/' + id + '.pdf#page=' + page
  });

  function search(url) {
    const kind = text(url,'kind');
    const query = text(url,'q');
    if (!query || query.length > 180) invalid('Nhập từ 1 đến 180 ký tự.');
    if (kind === 'event') {
      if (!/^4-\d{4}-\d{5,6}$/.test(query)) invalid('Nhập số đơn đầy đủ dạng 4-YYYY-NNNNN.');
      const source = sources.get('tm-events');
      return {
        kind, edition: 'Tuần 44 năm 2026', source: source.url, sourceLabel: source.label,
        rows: byApplication.all(query), asOf: report.events.maxTransfer,
        notice: 'Đây là sự kiện chuyển công bố trong bản đã lưu. Tình trạng hiện tại, ngày công bố trên Công báo và việc cấp văn bằng cần xác minh riêng.'
      };
    }
    const terms = countMatches(query).slice(0,14);
    if (!terms.length) invalid('Cần có từ khóa hoặc mã hợp lệ.');
    const match = terms.map(term => '"' + term + '"').join(' AND ');
    if (kind === 'nice') {
      const edition = text(url,'edition') || '2026';
      if (!['2026','2027'].includes(edition)) invalid('Chọn bản Nice 2026 hoặc WIPO 2027.');
      const cls = Number(text(url,'class'));
      if (!Number.isInteger(cls) || cls < 0 || cls > 45) invalid('Nhóm Nice từ 1 đến 45.');
      const data = /^\d{6}$/.test(query) ? niceExact.all(edition,query,cls,cls) : niceQuery.all(match,edition,cls,cls);
      const prov = report.editionProvenance[edition];
      return {
        kind, edition, source: sources.get(prov.textSource).metadata, ...prov,
        notice: edition === '2027'
          ? 'Bản WIPO 2027 dành cho so sánh. Dữ liệu này chưa được xác nhận áp dụng tại Việt Nam trong phạm vi M1.'
          : 'Thuật ngữ tra cứu theo Nice 13-2026. Luật sư đối chiếu mục đích hàng hóa, dịch vụ và nội dung mô tả. © WIPO cho dữ liệu tiếng Anh và Pháp.',
        rows: data.map(row => ({
          ...row, wipo: { uid: row.uid, member: prov.enMember, url: sources.get(prov.textSource).url },
          vnEvidence: row.vn_page ? evidence('nice-vn26',row.vn_page) : null
        }))
      };
    }
    if (kind !== 'law') invalid('Chọn loại nguồn hợp lệ.');
    const source = text(url,'source');
    if (source && sources.get(source)?.type !== 'pdf') invalid('Chọn tệp văn bản trong danh mục.');
    const exact = articleQuery.all('"' + fold(query) + '"',source,source);
    const matches = exact.length ? exact : articleQuery.all(match,source,source);
    return {
      kind, rows: matches.map(row => ({
        ...evidence(row.source,row.page), excerpt: excerpt(row.body,query)
      })),
      notice: 'Kết quả tìm trong văn bản. Kiểm phiên bản, vị trí điều khoản và phạm vi áp dụng trước khi sử dụng.'
    };
  }

  function review(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('Dữ kiện chưa hợp lệ.');
    const work = report.workflows[body.procedure];
    if (!Object.hasOwn(report.workflows,body.procedure) || !work) invalid('Chọn một hồ sơ trong phạm vi.');
    const flags = body.flags ?? {};
    if (typeof flags !== 'object' || Array.isArray(flags) ||
        Object.entries(flags).some(([key,val]) => !Object.hasOwn(work.flags,key) || !['yes','no','unknown'].includes(val))) {
      invalid('Dữ kiện checklist chưa hợp lệ.');
    }
    const resolution = resolveProcedure(body);
    const checklist = [];
    if (resolution.status === 'grounded') {
      for (const id of work.claims) {
        const claim = claims.get(id);
        const on = resolution.applicableOn;
        if ((claim.from_ && on < claim.from_) || (claim.until && on >= claim.until) ||
            (claim.flag && flags[claim.flag] === 'no')) continue;
        checklist.push({
          id, text: claim.text, locator: claim.locator, ...evidence(claim.source,claim.page),
          state: claim.flag && flags[claim.flag] !== 'yes' ? 'confirm' : 'review',
          question: claim.flag ? work.flags[claim.flag] : null
        });
      }
    }
    return {
      release: report.release, parentSotDigest: report.parentSotDigest, corpusDigest: report.inputDigest,
      workflow: work.label, resolution, checklist,
      notice: 'Hồ sơ rà soát cục bộ. Luật sư xác nhận dữ kiện, căn cứ và checklist trước khi dùng cho hồ sơ thật.'
    };
  }

  const pilot=process.env.DAI_TIN_PILOT==='1';
  const intake=body=>applyIntake(body,review,search);
  const runModel=createModelRouter({
    port:process.env.DAI_TIN_MODEL_PORT,model:process.env.DAI_TIN_MODEL_ID,keyFile:process.env.DAI_TIN_MODEL_KEY_FILE,catalog,apply:intake
  });

  function handleGet(url) {
    const path = url.pathname;
    const asset = assets.get(path);
    if (asset) return { value: readFileSync(here(asset[0])), type: asset[1] };
    if (path === '/api/copilot/catalog') {
      return { value: {
        release: report.release, parentSotDigest: report.parentSotDigest, corpusDigest: report.inputDigest, asOf: report.asOf,
        localModel: runModel ? process.env.DAI_TIN_MODEL_ID : null, pilot,
        responseWorkspace: process.env.DAI_TIN_M3 === '1',
        sources: [...sources.values()].map(({id,label,authority,role,url,metadata,type}) => ({
          id,label,authority,role,url,metadata,type,coverage:report.sourceCoverage[id] ?? null
        })),
        events: { ...report.events, reviewQueue: report.events.reviewQueue.length },
        editions: report.editionProvenance, workflows: report.workflows,
        lawPages: report.indexedLawPages, claims: report.claims
      }};
    }
    if (path === '/api/copilot/find') return { value: search(url) };
    if (path === '/api/copilot/intake/contract') return { value: intakeContract };
    const id = path.match(/^\/copilot\/source\/([a-z0-9-]+)\.pdf$/)?.[1];
    const doc = sources.get(id);
    if (doc?.type === 'pdf') {
      const bytes = readFileSync(proofFile(doc));
      if (fingerprint(bytes) !== doc.sha256) throw new Error('Bản PDF đã thay đổi ' + id);
      return { value: bytes, type: 'application/pdf' };
    }
    return null;
  }

  return { handleGet, review, search, intake, runModel, pilot, close: () => db.close() };
}
