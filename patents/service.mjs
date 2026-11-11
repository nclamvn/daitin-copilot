import { readFileSync, realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceManifest } from '../web/static-sources.mjs';
import { CaseError, hash } from '../copilot/m3/workflow.mjs';
import { renderPage } from '../copilot/m4/pdf.mjs';
import { digest } from '../sot/bundle.mjs';
import { loadDataset, searchDataset } from './dataset.mjs';
import { openPatentStore } from './store.mjs';
import { createPatentWorkflow, evidenceURL } from './workflow.mjs';
import { makePatentWord, patentWordRendererV2, patentWordType } from './word.mjs';
import { bindPatentPDF, bindPatentPDFPack, inspectPatentPDF, inspectPatentPDFPack, isAnonymizedPack,
  maxPatentPDFPackRequest, maxPatentPDFRequest, previewPatentPDF } from './intake.mjs';
export { CaseError as PatentAccessError } from '../copilot/m3/workflow.mjs';

const assets = new Map([
  ['/patents/', ['index.html', 'text/html; charset=utf-8']],
  ['/patents/app.css', ['app.css', 'text/css; charset=utf-8']],
  ['/patents/app.mjs', ['app.mjs', 'application/javascript; charset=utf-8']],
  ['/patents/pdf-intake.mjs', ['pdf-intake.mjs', 'application/javascript; charset=utf-8']]
]);
let capturedDataset;
const dataset = () => capturedDataset ??= loadDataset();
const recordView = (record, source, citation) => ({ record, source, openUrl: evidenceURL(record, source), originalUrl: source.url });
const appRoot = fileURLToPath(new URL('../', import.meta.url));
function caseInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new CaseError('Dữ kiện hồ sơ chưa hợp lệ.', 422);
  return body;
}
function pdfImage(bytes, sha256) {
  return { value: bytes, type: 'image/png', headers: { 'X-Source-SHA256': sha256 } };
}
function sourceBytes(source) {
  if (typeof source.snapshot !== 'string' || !['patents/data/snapshots/', 'corpus/snapshots/', 'copilot/snapshots/'].some(prefix => source.snapshot.startsWith(prefix)) || source.snapshot.split('/').includes('..')) throw new CaseError('Đường dẫn bản nguồn không hợp lệ.', 409);
  const path = realpathSync(resolve(appRoot, source.snapshot));
  if (!path.startsWith(realpathSync(appRoot) + sep)) throw new CaseError('Đường dẫn bản nguồn không hợp lệ.', 409);
  const bytes = readFileSync(path);
  if (hash(bytes) !== source.sha256) throw new CaseError('Bản nguồn đã lưu không còn khớp dấu kiểm.', 409);
  return bytes;
}

function demoSpec(catalog) {
  const explicit = catalog.demo ?? catalog.demonstration;
  const claimRecordId = explicit?.claimRecordId ?? 'ep-ep1004359b1-claim-1';
  const claim = catalog.records.find(item => item.id === claimRecordId && item.kind === 'patent');
  const recommended = explicit?.d1RecordIds ?? ['us-patent-5783810-page-7-1', 'us-patent-5783810-page-11-1'];
  const d1RecordIds = recommended.filter(id => catalog.records.some(item => item.id === id && item.kind === 'patent'));
  return claim && d1RecordIds.length ? { claimRecordId, d1RecordIds,
    notice: 'Nghiên cứu yêu cầu bảo hộ công khai với D1 minh họa. Kịch bản mô phỏng, không phải thông báo thẩm định thật.' } : null;
}

function anonymizedPilot(config) {
  if (typeof config !== 'string' || !config || config.length > 300) return null;
  let value;
  try { value = JSON.parse(config); }
  catch { return null; }
  const roles = ['notice', 'claim', 'd1'];
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== roles.length ||
      !roles.every(role => typeof value[role] === 'string' && /^[a-f0-9]{64}$/.test(value[role])) ||
      new Set(roles.map(role => value[role])).size !== roles.length) return null;
  const hashes = Object.fromEntries(roles.map(role => [role, value[role]]));
  // Login groups permit only lowercase letters, digits and hyphens. Old
  // deployments using the same Blob cannot resolve this private namespace.
  return { hashes, group: '@patent-pilot:' + digest(hashes) };
}

export function createPatentService({ storePath = process.env.DAI_TIN_M3_STORE, model,
  approvedPilot = process.env.DAI_TIN_ANONYMIZED_PATENT_PILOT } = {}) {
  const catalog = dataset();
  const store = openPatentStore(storePath);
  const workflow = createPatentWorkflow(store, catalog, model);
  const sources = new Map(catalog.sources.map(item => [item.id, item]));
  const datasetDigest = catalog.digest ?? catalog.datasetDigest ?? digest(catalog);
  const demo = demoSpec(catalog);
  const pilot = anonymizedPilot(approvedPilot);
  const stagedPDFs = new Set(sourceManifest().map(item => item.sha256));
  return {
    close: store.close,
    async handle(req, path, actor, readJSON, checkAccess = () => {}) {
      const get = req.method === 'GET' || req.method === 'HEAD';
      try {
        if (get && path === '/patents') return { status: 308, value: {}, headers: { Location: '/patents/' + new URL(req.url, 'https://pilot.invalid').search } };
        if (get && assets.has(path)) {
          const [filename, type] = assets.get(path);
          return { value: readFileSync(new URL('./ui/' + filename, import.meta.url)), type };
        }
        if (!actor) return { status: 401, value: { error: 'Cần đăng nhập để mở hồ sơ sáng chế.' } };
        const pilotActor = pilot && actor.name === 'binh' && actor.group === 'nhan-hieu' && actor.role === 'reviewer'
          ? { ...actor, group: pilot.group } : null;
        const caseActor = id => pilotActor && store.has(id, pilotActor.group) ? pilotActor : actor;
        const packActor = body => {
          if (!isAnonymizedPack(body)) return actor;
          if (!pilotActor) throw new CaseError('Bộ PDF ẩn danh chưa được cấp quyền cho pilot.', 403);
          return pilotActor;
        };
        const savedSource = path.match(/^\/api\/patents\/source\/([a-zA-Z0-9._:-]+)\/([a-f0-9]{64})$/);
        if (get && savedSource) {
          const source = sources.get(savedSource[1]);
          if (!source) throw new CaseError('Không tìm thấy bản nguồn đã lưu.', 404);
          if (source.sha256 !== savedSource[2]) throw new CaseError('Nguồn đã đổi phiên bản; mở lại đúng căn cứ trước khi dùng.', 409);
          const bytes = sourceBytes(source);
          const pdf = bytes.subarray(0, 5).toString('ascii') === '%PDF-';
          if (process.env.VERCEL === '1' && pdf && stagedPDFs.has(source.sha256)) {
            return { status: 302, value: {}, headers: { Location: '/__sources/' + source.sha256 + '.pdf' } };
          }
          if (bytes.length > 4.5 * 1024 * 1024) throw new CaseError('Bản nguồn này cần được đưa vào danh sách CDN đã kiểm trước khi mở trên web.', 503);
          return { value: bytes, type: pdf ? 'application/pdf' : 'application/octet-stream', headers: {
            'Content-Disposition': (pdf ? 'inline' : 'attachment') + '; filename="' + source.id + (pdf ? '.pdf' : '.source') + '"',
            'X-Source-SHA256': source.sha256,
            'Content-Security-Policy': "default-src 'none'; sandbox"
          } };
        }
        if (get && path === '/api/patents/status') return { value: { dataset: {
          status: 'candidate', builtAt: catalog.builtAt, digest: datasetDigest, sourceCount: catalog.sources.length,
          recordCount: catalog.records.length, gaps: catalog.gaps ?? [], scope: catalog.scope
        }, role: actor.role, model: process.env.DAI_TIN_MODEL_MODE === 'disabled' ? null : process.env.DAI_TIN_MODEL_ID,
        ...(pilotActor ? { anonymizedPilot: true, responseRevision: true } : {}),
        demo, notice: 'Nguồn ứng viên. Phân tích là suy luận cần luật sư rà soát, không kết luận tính mới, tình trạng quyền hoặc FTO.' } };
        if (get && path === '/api/patents/catalog') return { value: { status: 'candidate', datasetDigest, builtAt: catalog.builtAt,
          scope: catalog.scope, sources: catalog.sources, gaps: catalog.gaps ?? [], records: catalog.records.map(({ text, ...record }) => ({
            ...record, textPreview: text.slice(0, 320), textLength: text.length
          })) } };
        const evidence = path.match(/^\/api\/patents\/evidence\/([a-zA-Z0-9._:-]+)$/);
        if (get && evidence) {
          const record = catalog.records.find(item => item.id === evidence[1]);
          if (!record || !sources.has(record.sourceId)) throw new CaseError('Không tìm thấy chứng cứ sáng chế.', 404);
          return { value: recordView(record, sources.get(record.sourceId)) };
        }
        if (req.method === 'POST' && path === '/api/patents/search') {
          const input = await readJSON(req, 8192);
          if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CaseError('Nhập nội dung tra cứu hợp lệ.', 422);
          const found = searchDataset(input);
          return { value: { ...found, status: found.status === 'results' ? 'references' : found.status,
            results: found.results.map(item => recordView(item.record, item.source, item.citation)),
            notice: 'Kết quả truy hồi trong bộ nguồn đã lưu, chưa phải quyết định áp dụng pháp luật hoặc kết luận sáng chế.' } };
        }
        if (get && path === '/api/patents/cases') return { value: [
          ...(pilotActor ? workflow.list(pilotActor) : []), ...workflow.list(actor)
        ] };
        if (req.method === 'POST' && path === '/api/patents/pdf-pack/preview') {
          const body = caseInput(await readJSON(req, maxPatentPDFRequest));
          checkAccess();
          packActor(body);
          const image = await previewPatentPDF(body, pilot?.hashes);
          checkAccess();
          return pdfImage(image.bytes, image.sha256);
        }
        if (req.method === 'POST' && ['/api/patents/pdf-pack/inspect', '/api/patents/cases/pdf-pack'].includes(path)) {
          const body = caseInput(await readJSON(req, maxPatentPDFPackRequest));
          checkAccess();
          const owner = packActor(body);
          if (path.endsWith('/inspect')) {
            const value = await inspectPatentPDFPack(body, pilot?.hashes);
            checkAccess();
            return { value };
          }
          const selections = await bindPatentPDFPack(body, pilot?.hashes);
          checkAccess();
          return { status: 201, value: workflow.createFromPDFs(body, selections, owner) };
        }
        if (req.method === 'POST' && ['/api/patents/cases', '/api/patents/cases/example'].includes(path)) {
          const input = await readJSON(req, 64 * 1024); checkAccess();
          if (path.endsWith('/example')) {
            if (input?.synthetic !== true || !demo) throw new CaseError('Chưa có đủ claim và D1 công khai để mở ví dụ.', 422);
            const existing = workflow.list(actor).find(item => item.reference === 'PAT-DEMO-01');
            if (existing) return { value: workflow.read(existing.id, actor) };
            const claim = catalog.records.find(item => item.id === demo.claimRecordId);
            return { status: 201, value: workflow.create({ synthetic: true, reference: 'PAT-DEMO-01',
              title: 'Đối chiếu nhãn chia phần cho vật chứa mẫu', claimText: claim.text, claimVersion: claim.id,
              noticeText: 'THÔNG BÁO MÔ PHỎNG DO NHÓM TRIỂN KHAI SOẠN, KHÔNG PHẢI VĂN BẢN CƠ QUAN NHÀ NƯỚC. Đề nghị lập bảng đối chiếu yêu cầu bảo hộ đang nghiên cứu với tài liệu US5783810 được chọn làm D1 minh họa, chỉ rõ đoạn mô tả liên quan và điểm chưa đủ chứng cứ. Chưa có kết luận từ chối hoặc quyết định về tính mới.',
              instructionsText: 'CHỈ DẪN MÔ PHỎNG: dùng đúng nguyên văn claim và đoạn D1 đã chọn. Chuẩn bị dự thảo phản hồi nội bộ nêu phạm vi chứng cứ, điểm có thể đối chiếu và việc luật sư cần xác minh. Không bảo đảm kết quả cấp bằng hoặc tự suy ra hiệu lực quyền tại Việt Nam.',
              claimRecordId: claim.id, d1RecordIds: demo.d1RecordIds, evidenceIds: [claim.id, ...demo.d1RecordIds],
              jurisdiction: 'VN', asOf: catalog.builtAt?.slice(0, 10) ?? '2026-11-11' }, actor) };
          }
          return { status: 201, value: workflow.create(input, actor) };
        }
        const pdfAction = path.match(/^\/api\/patents\/cases\/([a-f0-9-]{36})\/pdf\/(inspect|preview|bind)$/);
        if (req.method === 'POST' && pdfAction) {
          const [, id, action] = pdfAction;
          if (caseActor(id) !== actor) throw new CaseError('Nguồn của hồ sơ pilot ẩn danh đã được khóa.', 422);
          const body = caseInput(await readJSON(req, maxPatentPDFRequest));
          checkAccess();
          workflow.checkVersion(id, body.version, actor);
          if (isAnonymizedPack(body)) throw new CaseError('Tiếp nhận PDF ẩn danh theo bộ đã được cấp quyền.', 422);
          if (action === 'inspect') {
            const value = await inspectPatentPDF(body, pilot?.hashes);
            checkAccess();
            workflow.checkVersion(id, body.version, actor);
            return { value };
          }
          if (action === 'preview') {
            const image = await previewPatentPDF(body, pilot?.hashes);
            checkAccess();
            workflow.checkVersion(id, body.version, actor);
            return pdfImage(image.bytes, image.sha256);
          }
          const selection = await bindPatentPDF(body, undefined, pilot?.hashes);
          checkAccess();
          return { value: workflow.bindPDF(id, body.version, selection, actor) };
        }
        const privatePDF = path.match(/^\/api\/patents\/cases\/([a-f0-9-]{36})\/pdf\/([a-f0-9-]{36})\/(download|page\/([1-9][0-9]*))$/);
        if (get && privatePDF) {
          const [, id, attachmentId, action, page] = privatePDF;
          const attachment = workflow.attachment(id, attachmentId, caseActor(id));
          if (action !== 'download') {
            const image = await renderPage(attachment.bytes, Number(page), attachment.pageCount);
            checkAccess();
            return pdfImage(image, attachment.sha256);
          }
          return { value: attachment.bytes, type: 'application/pdf', headers: {
            'Content-Disposition': 'attachment; filename="tai-lieu-sang-che-' + attachment.sha256.slice(0, 12) + '.pdf"',
            'X-Source-SHA256': attachment.sha256,
            'Content-Security-Policy': "default-src 'none'; sandbox"
          } };
        }
        const match = path.match(/^\/api\/patents\/cases\/([a-f0-9-]{36})(?:\/(source|propose|edit|approve|word|releases)(?:\/([1-9][0-9]*))?)?$/);
        if (match) {
          const [, id, action, number] = match;
          const owner = caseActor(id);
          if (get && !action) return { value: workflow.read(id, owner) };
          if (get && ['word', 'releases'].includes(action) && number) {
            const release = workflow.release(id, number, owner);
            if (action === 'releases') return { value: release };
            const bytes = release.template === patentWordRendererV2 ? store.wordArtifact(id, owner.group, release) : makePatentWord(release);
            return { value: bytes, type: patentWordType, headers: {
              'Content-Disposition': 'attachment; filename="' + release.reference.replaceAll('/', '-') + '-ban-' + release.number + '-daitin.docx"',
              'X-Artifact-SHA256': hash(bytes)
            } };
          }
          if (req.method === 'POST' && ['source', 'propose', 'edit', 'approve'].includes(action) && !number) {
            const body = caseInput(await readJSON(req, 64 * 1024)); checkAccess();
            return { value: await workflow[action](id, body, owner, checkAccess) };
          }
        }
        return { status: 404, value: { error: 'Không tìm thấy chức năng sáng chế trong pilot.' } };
      } catch (error) {
        if (!(error instanceof CaseError)) throw error;
        return { status: error.status, value: { error: error.message } };
      }
    }
  };
}
