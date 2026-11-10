import { execFile } from 'node:child_process';
import { bounded, CaseError, hash } from '../m3/workflow.mjs';

export const maxPDF = 4 * 1024 * 1024;
export const maxRequest = Math.ceil(maxPDF / 3) * 4 + 32768;
const maxPages = 12;
let active = 0;
const spaces = value => value.normalize('NFC').replace(/\s+/gu, ' ').trim();

export function pdfInput(body) {
  if (body?.anonymized !== true) throw new CaseError('Xác nhận PDF mô phỏng hoặc đã ẩn danh và được phép.');
  const encoded = body.content;
  if (typeof encoded !== 'string' || encoded.length > Math.ceil(maxPDF / 3) * 4 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4) {
    throw new CaseError('Chọn PDF hợp lệ, tối đa 4 MiB.');
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length > maxPDF || !/^%PDF-[0-9]\.[0-9]/.test(bytes.subarray(0, 8).toString('ascii'))) {
    throw new CaseError('Tệp phải là PDF hợp lệ, tối đa 4 MiB.');
  }
  return bytes;
}

function poppler(command, args, bytes, maxBuffer) {
  if (active >= 2) throw new CaseError('Đang đọc hai tệp. Hãy thử lại sau.', 429);
  active += 1;
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, { encoding: 'buffer', timeout: 8000, killSignal: 'SIGKILL',
      maxBuffer, env: { ...process.env, LC_ALL: 'C' } }, (error, stdout) => {
      active -= 1;
      if (error) reject(new CaseError(error.code === 'ENOENT' ? 'Máy này cần Poppler để đọc PDF.'
        : 'PDF bị khóa, hỏng hoặc vượt giới hạn xử lý. Kiểm tra tệp gốc.', error.code === 'ENOENT' ? 503 : 422));
      else resolve(stdout);
    });
    child.stdin.on('error', () => {});
    child.stdin.end(bytes);
  });
}

export const fieldNames = {
  application: 'Số đơn', title: 'Tên nhãn hiệu', receivedOn: 'Ngày cơ quan tiếp nhận đơn',
  noticeNumber: 'Số thông báo', noticeDate: 'Ngày thông báo', deadline: 'Hạn phản hồi ghi trên thông báo'
};
const matchers = {
  application: /^(?:Số đơn(?: đăng ký)?|Đơn số)\s*[:：]\s*(.+)$/iu,
  title: /^(?:Nhãn hiệu|Tên nhãn hiệu)\s*[:：]\s*(.+)$/iu,
  receivedOn: /^(?:Ngày (?:cơ quan )?tiếp nhận đơn)\s*[:：]\s*(.+)$/iu,
  noticeNumber: /^(?:Số thông báo|Thông báo số)\s*[:：]\s*(.+)$/iu,
  noticeDate: /^Ngày (?:thông báo|ban hành thông báo)\s*[:：]\s*(.+)$/iu,
  deadline: /^(?:Hạn phản hồi(?: ghi trên thông báo)?|Hạn trả lời)\s*[:：]\s*(.+)$/iu
};
const dateFields = new Set(['receivedOn', 'noticeDate', 'deadline']);

function isoDate(text) {
  const input = text.trim();
  const match = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(input);
  const iso = match ? match[3] + '-' + match[2].padStart(2, '0') + '-' + match[1].padStart(2, '0') : input;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const date = new Date(iso + 'T00:00:00Z');
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === iso ? iso : null;
}

export async function inspectPDF(bytes) {
  const info = (await poppler('pdfinfo', ['-'], bytes, 32768)).toString('utf8');
  const total = Number(/^Pages:\s+(\d+)$/m.exec(info)?.[1]);
  if (!Number.isInteger(total) || total < 1 || total > maxPages) throw new CaseError('PDF cần có từ 1 đến 12 trang.', 422);
  if (/^Encrypted:\s+yes\b/m.test(info)) throw new CaseError('Chọn PDF đã mở khóa và được phép dùng.', 422);
  const extracted = (await poppler('pdftotext', ['-layout', '-enc', 'UTF-8', '-', '-'], bytes, 300000)).toString('utf8');
  const splits = extracted.split('\f');
  if (splits.length !== total + 1 || splits.at(-1).trim()) throw new CaseError('Không đối chiếu được số trang PDF.', 422);
  const pages = splits.slice(0, total).map((text, index) => ({ page: index + 1, text: text.normalize('NFC').trim() }));
  const fields = Object.fromEntries(Object.keys(fieldNames).map(key => [key, []]));
  for (const page of pages) {
    for (const raw of page.text.split('\n')) {
      const line = spaces(raw);
      for (const [key, matcher] of Object.entries(matchers)) {
        const captured = matcher.exec(line)?.[1];
        if (!captured || captured.length > 100) continue;
        const value = dateFields.has(key) ? isoDate(captured) : captured;
        if (value && fields[key].length < 24 && !fields[key].some(item => item.value === value && item.page === page.page)) {
          fields[key].push({ value, page: page.page, line });
        }
      }
    }
  }
  return { sha256: hash(bytes), pages, fields };
}

export async function renderPage(bytes, page, total) {
  if (!Number.isInteger(page) || page < 1 || page > total || page > maxPages) throw new CaseError('Chọn trang PDF hợp lệ.');
  return poppler('pdftoppm', ['-f', String(page), '-l', String(page), '-scale-to', '1250', '-png', '-singlefile'], bytes, 7 * 1024 * 1024);
}

export function bindPDF(body, inspected, bytes) {
  const { anchors, verified, fields } = body.pdf ?? {};
  if (verified !== true || body.pdf.sha256 !== inspected.sha256) throw new CaseError('Xác nhận dữ kiện và đúng bản PDF trước khi lưu.');
  if (!Array.isArray(anchors) || !anchors.length || anchors.length > 3) throw new CaseError('Chọn từ một đến ba đoạn nguồn.');
  const sources = anchors.map(item => {
    const page = inspected.pages.find(row => row.page === item?.page);
    if (!page || !['text', 'manual'].includes(item.mode)) throw new CaseError('Đoạn nguồn phải gắn với một trang PDF.');
    const text = bounded(item.text, 1100, 'Đoạn nguồn PDF');
    if (item.mode === 'text' && !spaces(page.text).includes(spaces(text))) {
      throw new CaseError('Đoạn trích chưa khớp lớp văn bản của trang ' + page.page + '.', 422);
    }
    return { page: page.page, mode: item.mode, text };
  });
  if (new Set(sources.map(item => item.page + '\0' + spaces(item.text))).size !== sources.length) throw new CaseError('Đoạn nguồn trùng.');
  const label = bounded(body.pdf.label, 90, 'Tên PDF');
  const text = bounded(sources.map(item => item.text).join('\n\n'), 1100, 'Tổng đoạn nguồn');
  const values = { ...fields, title: body.title, receivedOn: body.receivedOn };
  const confirmed = Object.fromEntries(Object.entries(fieldNames).map(([key, fieldLabel]) => {
    const raw = values[key];
    if (raw === null || raw === undefined || raw === '') {
      if (new Set(inspected.fields[key].map(item => item.value)).size > 1) {
        throw new CaseError('Xác nhận ' + fieldLabel.toLowerCase() + ' vì PDF có nhiều giá trị.', 422);
      }
      return [key, { value: null, mode: 'missing', page: null }];
    }
    const entered = bounded(raw, 100, fieldLabel);
    const value = dateFields.has(key) ? isoDate(entered) : entered;
    if (!value) throw new CaseError(fieldLabel + ' cần dùng ngày hợp lệ.');
    const picked = body.pdf.accepted?.[key];
    const matched = inspected.fields[key].find(item => spaces(item.value) === spaces(value) && (!picked || picked.page === item.page));
    if (picked && (!matched || spaces(value) !== picked.value)) throw new CaseError('Gợi ý cho ' + fieldLabel.toLowerCase() + ' chưa khớp trang nguồn.', 422);
    return [key, { value, mode: matched ? 'confirmed-text' : 'manual', page: matched?.page ?? null }];
  }));
  return {
    notice: { label, text }, bytes,
    document: { label, sha256: inspected.sha256, pages: inspected.pages.length,
      anchors: sources, fields: confirmed, confirmedAt: new Date().toISOString() }
  };
}
