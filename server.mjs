import http from 'node:http';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { getCatalog, getEvidence, InputError, resolveProcedure, search, snapshots } from './research.mjs';

const copilotEnabled = process.env.DAI_TIN_COPILOT === '1';
const copilotModule = copilotEnabled ? await import('./copilot/service.mjs') : null;
const m3Module = process.env.DAI_TIN_M3 === '1' ? await import('./copilot/m3/api.mjs') : null;

const content = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.css', ['app.css', 'text/css; charset=utf-8']],
  ['/fonts.css', ['fonts.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'application/javascript; charset=utf-8']],
  ['/mark.svg', ['mark.svg', 'image/svg+xml']]
]);
const maxBodyBytes = 8192;

function respond(res, status, value, type = 'application/json; charset=utf-8', head = false, headers = {}) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));
  res.writeHead(status, {
    'Content-Type': type,
    'Content-Length': bytes.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; font-src 'self' data:; img-src 'self' data: blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    ...headers
  });
  res.end(head ? undefined : bytes);
}

async function readJSON(req, maxBytes = maxBodyBytes) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) {
    throw new InputError('Dùng định dạng application/json.');
  }
  const chunks = [];
  let total = 0;
  for await (const part of req.iterator({ destroyOnReturn: false })) {
    total += part.length;
    if (total > maxBytes) {
      req.resume();
      throw new InputError('Yêu cầu vượt quá dung lượng cho phép.');
    }
    chunks.push(part);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new InputError('Dữ liệu gửi lên không hợp lệ.');
  }
}

export function createServer() {
  const copilot = copilotModule?.createCopilot(getCatalog(), resolveProcedure);
  const m3 = m3Module?.createM3(copilot?.review);
  const server = http.createServer({ requestTimeout: 10000 }, async (req, res) => {
    try {
      const host = req.headers.host ?? '';
      const port = req.socket.localPort;
      if (!['127.0.0.1:' + port, 'localhost:' + port].includes(host) ||
          (req.headers.origin && req.headers.origin !== 'http://' + host)) {
        return respond(res, 403, { error: 'MVP chỉ phục vụ truy cập cục bộ.' });
      }
      const url = new URL(req.url, 'http://127.0.0.1');
      const path = url.pathname;
      const head = req.method === 'HEAD';
      if (m3 && (path.startsWith('/copilot/m3') || path.startsWith('/api/m3/') || path.startsWith('/api/m4/'))) {
        const result = await m3.handle(req, path, readJSON);
        if (result) return respond(res, result.status ?? 200, result.value, result.type, head, result.headers);
      }
      if (req.method === 'GET' || head) {
        const desk = copilot?.handleGet(url);
        if (desk) return respond(res, 200, desk.value, desk.type, head);
        const item = content.get(path);
        if (item) {
          const [file, type] = item;
          return respond(res, 200, readFileSync(new URL('./public/' + file, import.meta.url)), type, head);
        }
        if (path === '/api/catalog') return respond(res, 200, getCatalog(), undefined, head);
        const evidenceId = path.match(/^\/api\/evidence\/([a-z0-9-]+)$/)?.[1];
        const evidence = evidenceId ? getEvidence(evidenceId) : null;
        if (evidence) return respond(res, 200, evidence, undefined, head);
        const sourceId = path.match(/^\/sources\/([a-z0-9-]+)\.pdf$/)?.[1];
        if (snapshots.has(sourceId)) return respond(res, 200, snapshots.get(sourceId), 'application/pdf', head);
      }
      if (copilot?.runModel && req.method === 'POST' && path === '/api/copilot/intake/run') {
        const body = await readJSON(req, 12 * 1024);
        if (copilot.pilot && body?.anonymized!==true) {
          return respond(res, 400, { error: 'Xác nhận yêu cầu đã ẩn danh và được phép sử dụng trong pilot.' });
        }
        return respond(res, 200, await copilot.runModel(body?.request));
      }
      if (copilot && req.method === 'POST' && path === '/api/copilot/intake/apply') {
        const body = await readJSON(req, 20 * 1024);
        if (copilot.pilot && body?.anonymized!==true) {
          return respond(res, 400, { error: 'Xác nhận yêu cầu đã ẩn danh và được phép sử dụng trong pilot.' });
        }
        return respond(res, 200, copilot.intake(body));
      }
      if (copilot && req.method === 'POST' && path === '/api/copilot/review') {
        return respond(res, 200, copilot.review(await readJSON(req)));
      }
      if (req.method === 'POST' && (path === '/api/resolve' || path === '/api/search')) {
        const body = await readJSON(req);
        const result = path === '/api/resolve' ? resolveProcedure(body) : search(body?.query, body?.on);
        return respond(res, 200, result);
      }
      return respond(res, 404, { error: 'Không tìm thấy trong phạm vi MVP.' }, undefined, head);
    } catch (error) {
      if (error instanceof InputError || (copilotModule && (error instanceof copilotModule.CopilotInputError || error instanceof copilotModule.IntakeError))) {
        return respond(res, 400, { error: error.message });
      }
      console.error('Lỗi xử lý yêu cầu:', error.name);
      return respond(res, 500, { error: 'Tạm thời không xử lý được yêu cầu.' });
    }
  });
  if (copilot) server.once('close', copilot.close);
  if (m3) server.once('close', m3.close);
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 4310);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT không hợp lệ');
  createServer().listen(port, '127.0.0.1', () => {
    console.log('Đại Tín Research • http://127.0.0.1:' + port);
  });
}
