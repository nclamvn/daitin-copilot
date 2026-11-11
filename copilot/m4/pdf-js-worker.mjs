import { fileURLToPath } from 'node:url';
import { parentPort, workerData } from 'node:worker_threads';
import { CaseError } from '../m3/workflow.mjs';

// The cloud provider consumes bytes only. PDF JavaScript and remote resource
// fetching are never enabled; supporting fonts/CMaps come from the npm package.
const maxBytes = 2 * 1024 * 1024;
const maxTextBytes = 300000;
const maxPages = 12;
const maxOutputBytes = 4 * 1024 * 1024;
let runtime;

async function getRuntime() {
  runtime ??= (async () => {
    const canvas = await import('@napi-rs/canvas');
    for (const key of ['DOMMatrix', 'ImageData', 'Path2D']) globalThis[key] ??= canvas[key];
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    return { canvas, pdfjs };
  })();
  return runtime;
}

const resourcePath = name => fileURLToPath(new URL('../../node_modules/pdfjs-dist/' + name + '/', import.meta.url));

async function withDocument(bytes, operation) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > maxBytes ||
      !/^%PDF-[0-9]\.[0-9]/.test(Buffer.from(bytes).subarray(0, 8).toString('ascii'))) {
    throw new CaseError('Chọn PDF hợp lệ, tối đa 2 MiB.', 422);
  }
  let task;
  try {
    const { canvas, pdfjs } = await getRuntime();
    task = pdfjs.getDocument({
      data: new Uint8Array(bytes), isEvalSupported: false, useWorkerFetch: false,
      useSystemFonts: false, disableAutoFetch: true, disableStream: true,
      isOffscreenCanvasSupported: false, isImageDecoderSupported: false,
      maxImageSize: 16 * 1024 * 1024, canvasMaxAreaInBytes: 16 * 1024 * 1024,
      enableXfa: false, stopAtErrors: true, useWasm: false,
      standardFontDataUrl: resourcePath('standard_fonts'), cMapUrl: resourcePath('cmaps'), cMapPacked: true,
      verbosity: 0
    });
    const document = await task.promise;
    if (!Number.isInteger(document.numPages) || document.numPages < 1 || document.numPages > maxPages) {
      throw new CaseError('PDF cần có từ 1 đến 12 trang.', 422);
    }
    if ((await document.getPermissions()) !== null) throw new CaseError('Chọn PDF đã mở khóa và được phép dùng.', 422);
    return await operation(document, canvas);
  } catch (error) {
    if (error instanceof CaseError) throw error;
    throw new CaseError(error?.name === 'PasswordException' ? 'Chọn PDF đã mở khóa và được phép dùng.'
      : 'PDF bị khóa, hỏng hoặc vượt giới hạn xử lý. Kiểm tra tệp gốc.', 422);
  } finally {
    await task?.destroy().catch(() => {});
  }
}

function pageText(items) {
  const lines = [];
  let line = '';
  let priorY;
  const flush = () => { if (line.trim()) lines.push(line.trim()); line = ''; };
  for (const item of items) {
    if (typeof item.str !== 'string') continue;
    const y = item.transform?.[5];
    if (priorY !== undefined && Number.isFinite(y) && Math.abs(y - priorY) > 2) flush();
    if (line && !/\s$/.test(line) && !/^\s/.test(item.str)) line += ' ';
    line += item.str;
    priorY = y;
    if (item.hasEOL) { flush(); priorY = undefined; }
  }
  flush();
  return lines.join('\n').normalize('NFC');
}

async function inspectWithPDFJS(bytes) {
  return withDocument(bytes, async document => {
    const pages = [];
    let textBytes = 0;
    for (let number = 1; number <= document.numPages; number += 1) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      if (content.items.length > 40000) throw new CaseError('Lớp văn bản PDF vượt giới hạn xử lý.', 422);
      const text = pageText(content.items);
      textBytes += Buffer.byteLength(text, 'utf8');
      if (textBytes > maxTextBytes) throw new CaseError('Lớp văn bản PDF vượt giới hạn xử lý.', 422);
      pages.push({ page: number, text });
      page.cleanup();
    }
    return pages;
  });
}

async function renderWithPDFJS(bytes, number) {
  return withDocument(bytes, async (document, canvas) => {
    if (!Number.isInteger(number) || number < 1 || number > document.numPages) throw new CaseError('Chọn trang PDF hợp lệ.');
    const page = await document.getPage(number);
    const original = page.getViewport({ scale: 1 });
    if (!Number.isFinite(original.width) || !Number.isFinite(original.height) || original.width <= 0 || original.height <= 0) {
      throw new CaseError('Kích thước trang PDF chưa hợp lệ.', 422);
    }
    const viewport = page.getViewport({ scale: Math.min(1250 / original.width, 1250 / original.height) });
    const surface = canvas.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    try {
      const task = page.render({ canvasContext: surface.getContext('2d'), viewport });
      await task.promise;
      const image = await surface.encode('png');
      if (image.byteLength > maxOutputBytes) throw new CaseError('Ảnh trang PDF vượt giới hạn xem trước.', 422);
      return Buffer.from(image);
    } finally {
      surface.width = 1;
      surface.height = 1;
      page.cleanup();
    }
  });
}

// This module is a worker entrypoint, never a URL- or user-supplied script.
if (!parentPort || !['inspect', 'render'].includes(workerData?.operation)) throw new Error('PDF worker invocation required.');
try {
  const result = workerData.operation === 'inspect'
    ? await inspectWithPDFJS(workerData.bytes) : await renderWithPDFJS(workerData.bytes, workerData.page);
  parentPort.postMessage({ result });
} catch (error) {
  parentPort.postMessage({ error: { message: error instanceof CaseError ? error.message : 'PDF chưa xử lý được.', status: error instanceof CaseError ? error.status : 422 } });
}
