import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { digest, sha256 } from './bundle.mjs';

const snapshots = new URL('../corpus/snapshots/', import.meta.url);
export const allowedHosts = new Set(['datafiles.chinhphu.vn', 'congbaocdn.chinhphu.vn', 'ipvietnam.gov.vn']);
const has = (value, key) => typeof key === 'string' && Object.hasOwn(value, key);
const isDate = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
};
const fold = value => value.normalize('NFD').toLowerCase().replace(/\p{M}/gu, '')
  .replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, ' ').trim();

const assert = (condition, tag, detail) => {
  if (!condition) throw new Error(tag + ': ' + detail);
};

export function approvedSourceUrl(value) {
  const url = new URL(value);
  assert(url.protocol === 'https:' && allowedHosts.has(url.hostname) &&
    !url.username && !url.password && !url.port && !url.hash,
  'SOURCE_RIGHTS', value);
  return url;
}

function pdfTool(command, args, options = {}) {
  try {
    return execFileSync(command, args, { maxBuffer: 24 * 1024 * 1024, timeout: 15000, ...options });
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('Cần công cụ ' + command + ' để tái dựng bằng chứng.');
    throw new Error('PDF_READ: ' + command + ' không đọc được nguồn hoặc quá thời gian.');
  }
}

export function makePdfReader(documents) {
  const files = new Map();
  const pages = new Map();
  function snapshot(id) {
    if (!files.has(id)) {
      const doc = documents[id];
      const file = fileURLToPath(new URL(doc.file, snapshots));
      const bytes = readFileSync(file);
      assert(bytes.subarray(0, 5).toString() === '%PDF-', 'CAPTURE_TYPE', id);
      assert(sha256(bytes) === doc.sha256, 'SNAPSHOT_HASH', id);
      const info = pdfTool('pdfinfo', [file], { encoding: 'utf8' });
      assert(Number(info.match(/^Pages:\s+(\d+)/m)?.[1]) === doc.pages, 'PAGE_COUNT', id);
      files.set(id, file);
    }
    return files.get(id);
  }
  function page(docId, pageNumber, method) {
    const key = [docId, pageNumber, method].join('/');
    if (!pages.has(key)) {
      const file = snapshot(docId);
      const n = String(pageNumber);
      let original;
      if (method === 'ocr') {
        const raster = pdfTool('pdftoppm', ['-f', n, '-l', n, '-r', '112', '-gray', '-singlefile', file]);
        original = pdfTool('tesseract', ['stdin', 'stdout', '--psm', '11'], {
          input: raster, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore']
        });
      } else {
        original = pdfTool('pdftotext', ['-layout', '-f', n, '-l', n, file, '-'], { encoding: 'utf8' });
      }
      pages.set(key, { original, normalized: fold(original) });
    }
    return pages.get(key);
  }
  return { snapshot, page };
}

function validateLifecycle(registry) {
  const { documents, forms, provisions, procedures, coveredFrom, checkedThrough, cutover, cutoverBasis, boundaryBasis } = registry;
  assert([coveredFrom, checkedThrough, cutover].every(isDate) && coveredFrom < cutover && cutover <= checkedThrough,
    'DATE_SCOPE', 'phạm vi thời gian');
  assert(has(provisions, cutoverBasis?.transition) && has(provisions, cutoverBasis?.effective) &&
    cutoverBasis.transition !== cutoverBasis.effective, 'TRANSITION_MISSING', 'Điều 17 và 18 phải có bản ghi riêng');
  assert(boundaryBasis?.length && boundaryBasis.every(key => has(provisions, key)) &&
    has(provisions, 'tt10-138-1'), 'TRANSITION_MISSING', 'mốc đầu phạm vi cần văn bản và căn cứ chuyển tiếp');
  const assigned = new Set();
  for (const [id, procedure] of Object.entries(procedures)) {
    assert(Array.isArray(procedure.versions) && procedure.versions.every(form => has(forms, form)) &&
      (procedure.versions.length || procedure.basis?.length), 'PROCEDURE_BASIS', id);
    for (const [index, formId] of procedure.versions.entries()) {
      const form = forms[formId];
      const next = procedure.versions[index + 1];
      assert(!assigned.has(formId), 'FORM_SCOPE', formId);
      assigned.add(formId);
      assert(form.from === (index === 0 ? coveredFrom : cutover) && form.until === (next ? forms[next].from : undefined) &&
        form.successor === next && (index < 2), 'VERSION_INTERVAL', formId);
      assert(form.basis?.length && form.basis.every(key => has(provisions, key)), 'FORM_BASIS', formId);
    }
    assert((procedure.basis ?? []).every(key => has(provisions, key)), 'PROCEDURE_BASIS', id);
  }
  assert(assigned.size === Object.keys(forms).length, 'FORM_SCOPE', 'có mẫu không gắn thủ tục');
  for (const [id, item] of Object.entries({ ...forms, ...provisions })) {
    assert(has(documents, item.document) && Number.isInteger(item.page) && item.page > 0 &&
      item.page <= documents[item.document].pages, 'LOCATOR_PAGE', id);
    assert(isDate(item.from) && (!item.until || isDate(item.until) && item.from < item.until),
      'DATE_SCOPE', id);
  }
}

function verifyEvidence(input, reader) {
  const { registry, evidence, crossChecks } = input;
  const items = { ...registry.provisions, ...registry.forms };
  assert(Object.keys(evidence).length === Object.keys(items).length, 'EVIDENCE_MISSING', 'số bản ghi khác số bằng chứng');
  const results = {};
  for (const [id, row] of Object.entries(items)) {
    const check = evidence[id];
    assert(check?.anchors?.length && ['text', 'ocr'].includes(check.method) &&
      check.anchors.every(anchor => typeof anchor === 'string' && fold(anchor).length > 3),
    'EVIDENCE_MISSING', id);
    const { original, normalized } = reader.page(row.document, row.page, check.method);
    for (const anchor of check.anchors) {
      assert(normalized.includes(fold(anchor)), 'SPAN_NOT_FOUND', id + ' tại trang ' + row.page + ' → ' + anchor);
    }
    if (row.quote) assert(fold(original).includes(fold(row.quote)), 'QUOTE_NOT_FOUND', id);
    if (id === 'tt10-109-3a') {
      assert(row.article === 109 && row.clause === '3' && row.point === 'a' &&
        row.locator === 'Điều 109 khoản 3 điểm a' && normalized.includes('3 trong mot ho so co the yeu cau gia han'),
      'LOCATOR_CLAUSE', id);
    }
    if (has(registry.forms, id)) {
      assert(/^\d{2}$/.test(row.number) && ['I', 'II'].includes(row.appendix), 'FORM_IDENTITY', id);
      const label = check.method === 'ocr' ? 'm(?:au|iu) s(?:o|e)' : 'mau so';
      assert(new RegExp('\\b' + label + ' ' + row.number + '\\b').test(normalized.slice(0, 900)), 'FORM_NUMBER', id);
      assert(check.appendix === row.appendix && check.document === row.document, 'FORM_IDENTITY', id);
    }
    results[id] = { document: row.document, page: row.page, method: check.method, pageTextDigest: sha256(normalized) };
  }

  const effective = registry.provisions[registry.cutoverBasis.effective];
  const transition = registry.provisions[registry.cutoverBasis.transition];
  const [year, month, day] = registry.cutover.split('-');
  const cutoffPage = reader.page(effective.document, effective.page, 'text').normalized;
  assert(effective.document === 'tt20' && effective.article === 18 && effective.clause === '2' &&
    cutoffPage.includes('tu ngay ' + day + ' thang ' + Number(month) + ' nam ' + year),
  'CUTOVER_SOURCE', registry.cutover);
  const transitionPage = reader.page(transition.document, transition.page, 'text').normalized;
  assert(transition.document === 'tt20' && transition.article === 17 && transition.clause === '2' &&
    transitionPage.includes('chua giai quyet xong') && transitionPage.includes('thoi diem tiep nhan don ho so do'),
  'TRANSITION_SOURCE', 'thiếu điều kiện hồ sơ đang xử lý hoặc ngày tiếp nhận');
  const april = registry.provisions['tt10-138-1'];
  const aprilPage = reader.page(april.document, april.page, 'text').normalized;
  const [firstYear, firstMonth, firstDay] = registry.coveredFrom.split('-');
  assert(april.article === 138 && april.clause === '1' && april.document === 'tt10' &&
    april.from === registry.coveredFrom &&
    aprilPage.includes('tu ngay ' + firstDay + ' thang ' + Number(firstMonth) + ' nam ' + firstYear),
  'COVERAGE_START_SOURCE', registry.coveredFrom);

  for (const check of crossChecks) {
    assert(has(registry.documents, check.document) && check.page >= 1 &&
      check.page <= registry.documents[check.document].pages && check.anchors?.length, 'CROSSCHECK_LOCATOR', check.id);
    const { normalized } = reader.page(check.document, check.page, 'text');
    for (const anchor of check.anchors) assert(normalized.includes(fold(anchor)), 'CROSSCHECK_SPAN', check.id + ' → ' + anchor);
  }
  return results;
}

export function buildCandidate(input, suppliedReader) {
  const { registry, sources, scope, coverage, reviewCases, gaps, crossChecks } = input;
  assert(scope.id === 'vn-national-trademark' && scope.ownerRole === 'Chủ dữ liệu Đại Tín' &&
    scope.reviewerRole === 'Luật sư SHTT Đại Tín', 'SCOPE_OWNER', 'thiếu phạm vi hoặc vai trò');
  const reader = suppliedReader ?? makePdfReader(registry.documents);
  const sourceRoles = new Set(['enacted_text_or_annex', 'consolidation', 'agency_guidance']);
  for (const [id, doc] of Object.entries(registry.documents)) {
    approvedSourceUrl(doc.url);
    const source = sources[id];
    assert(/^[a-z0-9-]+\.pdf$/.test(doc.file) && /^[a-f0-9]{64}$/.test(doc.sha256) &&
      source?.authority === doc.authority && source.ownerRole === scope.ownerRole &&
      sourceRoles.has(source.sourceRole) && isDate(source.capturedOn) && source.capturedOn >= registry.checkedThrough &&
      source.permissions?.snapshot === 'local_review' && source.permissions?.index === 'local_review' &&
      source.permissions?.externalRelease === 'pending_owner_review',
    'SOURCE_RIGHTS', id);
    reader.snapshot(id);
  }
  validateLifecycle(registry);
  assert(Object.values(registry.forms).every(row => sources[row.document].sourceRole === 'enacted_text_or_annex'),
    'FORM_AUTHORITY', 'biểu mẫu cần trỏ bản ban hành hoặc phụ lục');
  assert(Object.keys(registry.procedures).every(id => coverage.some(row => row.procedure === id)) &&
    new Set(coverage.map(row => row.procedure)).size === coverage.length &&
    coverage.every(row => has(registry.procedures, row.procedure) && row.unresolved?.length &&
      JSON.stringify(row.versions) === JSON.stringify(registry.procedures[row.procedure].versions) &&
      [...row.decisionBasis, ...row.readingOnly].every(key => has(registry.provisions, key))),
    'COVERAGE', 'thiếu ma trận hoặc giới hạn thủ tục');
  assert(reviewCases.length >= 8 && new Set(reviewCases.map(item => item.id)).size === reviewCases.length &&
    gaps.length > 0, 'REVIEW_QUEUE', 'thiếu bộ ca hoặc hàng đợi');
  const pageProof = verifyEvidence(input, reader);
  const payload = {
    kind: 'vn-trademark-sot-v1',
    registry, sources, scope, coverage, reviewCases, gaps, crossChecks, pageProof,
    inputDigest: digest(input)
  };
  return { digest: digest(payload), approval: null, payload };
}
