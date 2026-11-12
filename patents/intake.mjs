import { CaseError, bounded, hash } from '../copilot/m3/workflow.mjs';
import { inspectPDF, pdfEngine, renderPage } from '../copilot/m4/pdf.mjs';
import { matchesPilotSource, maxPatentExcerptChars as maxExcerptChars, maxPatentPDFPages, patentPDFRoles as pdfRoles } from './pilot-lock.mjs';
export { maxPatentPDFPages } from './pilot-lock.mjs';

export const maxPatentPDFBytes = 2 * 1024 * 1024;
const maxEncodedBytes = Math.ceil(maxPatentPDFBytes / 3) * 4;
export const maxPatentPDFRequest = maxEncodedBytes + 24 * 1024;
// Three separately padded Base64 values and the selected excerpts/metadata.
export const maxPatentPDFPackRequest = maxEncodedBytes + 64 * 1024;
const maxRange = 4;

export function isAnonymizedPack(body) {
  return body?.synthetic === false && body?.anonymized === true;
}

function inputBytes(body, lock) {
  const anonymized = isAnonymizedPack(body);
  if (!anonymized && (body?.synthetic !== true || body.anonymized === true)) {
    throw new CaseError('Chọn loại PDF được phép đưa vào pilot.', 422);
  }
  if (anonymized && (!lock || !pdfRoles.includes(body.role))) {
    throw new CaseError('Bộ PDF ẩn danh chưa được cấp quyền cho pilot.', 403);
  }
  const content = body.content;
  if (typeof content !== 'string' || content.length > maxEncodedBytes || content.length % 4 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(content)) {
    throw new CaseError('Chọn PDF hợp lệ, tối đa 2 MiB.', 422);
  }
  const bytes = Buffer.from(content, 'base64');
  if (bytes.length > maxPatentPDFBytes || !/^%PDF-[0-9]\.[0-9]/.test(bytes.subarray(0, 8).toString('ascii'))) {
    throw new CaseError('Tệp phải là PDF hợp lệ, tối đa 2 MiB.', 422);
  }
  const sha256 = hash(bytes);
  if (anonymized && lock.sources[body.role].sha256 !== sha256) {
    throw new CaseError('Tệp này không khớp bộ PDF đã được phép dùng cho vai trò đã chọn.', 422);
  }
  if (!anonymized && lock && Object.values(lock.sources).some(source => source.sha256 === sha256)) {
    throw new CaseError('Tệp phải được tiếp nhận theo đúng loại hồ sơ đã đăng ký.', 422);
  }
  if (body.sha256 !== undefined && body.sha256 !== sha256) {
    throw new CaseError('PDF đã đổi sau khi đọc. Đọc lại đúng tệp trước khi tiếp tục.', 409);
  }
  return bytes;
}

const usableText = text => Boolean(text.trim()) && text.isWellFormed() && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFD-\uFFFF]/u.test(text);

function pageRange({ firstPage, lastPage }) {
  if (!Number.isInteger(firstPage) || !Number.isInteger(lastPage) || firstPage < 1 ||
      lastPage < firstPage || lastPage > maxPatentPDFPages || lastPage - firstPage + 1 > maxRange) {
    throw new CaseError('Chọn từ 1 đến 4 trang liên tiếp trong PDF tối đa 12 trang.', 422);
  }
  return { firstPage, lastPage };
}

async function readRange(body, bytes) {
  const { firstPage, lastPage } = pageRange(body);
  const inspected = await inspectPDF(bytes);
  const pageCount = inspected.pages.length;
  if (lastPage > pageCount) throw new CaseError('Khoảng trang đã chọn vượt số trang của PDF.', 422);
  const pages = inspected.pages.slice(firstPage - 1, lastPage).map(({ page, text }) => ({ page, text, usable: usableText(text) }));
  return { bytes, inspection: { sha256: inspected.sha256, pageCount, pages, maxExcerptChars, extractionEngine: pdfEngine } };
}

const lockedRange = source => ({ firstPage: source.page, lastPage: source.page });
const matchesLockedRange = (input, source) => [input.firstPage, input.lastPage].every(page => page === undefined || page === source.page);
function checkLockedText(inspection, source) {
  const page = inspection.pages[0];
  const text = page.text.slice(source.start, source.end);
  if (!page.usable || text.length !== source.end - source.start || text !== text.trim() ||
      !usableText(text) || hash(text) !== source.textSha256) {
    throw new CaseError('Đoạn trích của PDF không khớp bộ nguồn đã duyệt cho pilot.', 409);
  }
}

export async function inspectPatentPDF(body, lock) {
  return (await readRange(body, inputBytes(body, lock))).inspection;
}

export async function previewPatentPDF(body, lock) {
  if (!/^[a-f0-9]{64}$/.test(body?.sha256 ?? '')) throw new CaseError('Đọc PDF trước khi mở trang nguồn.', 422);
  const bytes = inputBytes(body, lock);
  if (!Number.isInteger(body.page) || body.page < 1 || body.page > maxPatentPDFPages) {
    throw new CaseError('Chọn trang PDF hợp lệ.', 422);
  }
  if (isAnonymizedPack(body)) {
    const source = lock.sources[body.role];
    if (body.page !== source.page) throw new CaseError('Chỉ mở trang PDF đã khóa cho vai trò này.', 422);
    const { inspection } = await readRange(lockedRange(source), bytes);
    checkLockedText(inspection, source);
    return { sha256: inspection.sha256, bytes: await renderPage(bytes, body.page, inspection.pageCount) };
  }
  const inspected = await inspectPDF(bytes);
  return { sha256: inspected.sha256, bytes: await renderPage(bytes, body.page, inspected.pages.length) };
}

export async function bindPatentPDF(body, bytes, lock) {
  if (body?.confirmed !== true || !/^[a-f0-9]{64}$/.test(body.sha256 ?? '')) {
    throw new CaseError('Xác nhận đoạn trích đã đối chiếu với đúng bản PDF.', 422);
  }
  if (!pdfRoles.includes(body.role)) throw new CaseError('Chọn vai trò của đoạn PDF trong hồ sơ.', 422);
  const label = bounded(body.label, 100, 'Tên tài liệu PDF');
  if (!usableText(label) || /[\r\n\t]/.test(label)) throw new CaseError('Tên tài liệu PDF cần nằm trên một dòng.', 422);
  const { bytes: original, inspection } = await readRange(body, bytes ?? inputBytes(body, lock));
  const { role, page, start, end, text } = body;
  const selected = inspection.pages.find(item => item.page === page);
  if (!selected) throw new CaseError('Chọn đoạn trích trong khoảng trang đã đọc.', 422);
  if (!selected.usable) throw new CaseError('Trang không có lớp chữ dùng được. Kiểm tra bản gốc hoặc cung cấp PDF có lớp chữ.', 422);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > selected.text.length ||
      end - start > maxExcerptChars || typeof text !== 'string' || text !== text.trim() || !usableText(text) ||
      selected.text.slice(start, end) !== text) {
    throw new CaseError('Đoạn xác nhận phải trùng nguyên văn lớp chữ của đúng trang, tối đa 1.800 ký tự.', 422);
  }
  return { bytes: original, label, role, page, start, end, text, pageCount: inspection.pageCount,
    sha256: inspection.sha256, textSha256: hash(text), extractionEngine: inspection.extractionEngine };
}

function packInputs(body, lock) {
  const documents = body?.documents;
  if (!Array.isArray(documents) || documents.length !== pdfRoles.length ||
      new Set(documents.map(item => item?.role)).size !== pdfRoles.length ||
      documents.some(item => !pdfRoles.includes(item?.role))) {
    throw new CaseError('Chọn đúng một PDF cho từng vai trò thông báo, yêu cầu bảo hộ và D1.', 422);
  }
  const inputs = documents.map(item => {
    const input = { ...item, synthetic: body.synthetic, anonymized: body.anonymized };
    return { input, bytes: inputBytes(input, lock) };
  });
  if (inputs.reduce((total, item) => total + item.bytes.length, 0) > maxPatentPDFBytes) {
    throw new CaseError('Tổng dung lượng ba PDF tối đa 2 MiB.', 422);
  }
  return inputs;
}

export async function inspectPatentPDFPack(body, lock) {
  const locked = isAnonymizedPack(body) ? lock : null;
  const documents = [];
  for (const { input, bytes } of packInputs(body, lock)) {
    const source = locked?.sources[input.role];
    if (source && !matchesLockedRange(input, source)) {
      throw new CaseError('Chỉ mở trang PDF đã khóa cho vai trò này.', 422);
    }
    const { inspection } = await readRange(source ? lockedRange(source) : input, bytes);
    if (source) checkLockedText(inspection, source);
    documents.push({ role: input.role, ...inspection });
  }
  return { documents, ...(locked ? { locked: { reference: lock.reference, asOf: lock.asOf, sources: lock.sources } } : {}) };
}

export async function bindPatentPDFPack(body, lock) {
  const locked = isAnonymizedPack(body) ? lock : null;
  const selections = [];
  for (const { input, bytes } of packInputs(body, lock)) {
    const source = locked?.sources[input.role];
    if (source) {
      const textSha256 = typeof input.text === 'string' && input.text.length === source.end - source.start && hash(input.text);
      if (!matchesPilotSource({ ...input, textSha256 }, source) ||
          (input.textSha256 !== undefined && input.textSha256 !== textSha256) || !matchesLockedRange(input, source)) {
        throw new CaseError('Trang hoặc đoạn trích không khớp bộ nguồn đã duyệt cho pilot.', 422);
      }
    }
    selections.push(await bindPatentPDF(source ? { ...input, ...lockedRange(source) } : input, bytes));
  }
  return selections;
}
