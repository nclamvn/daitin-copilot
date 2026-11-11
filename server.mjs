import http from 'node:http';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { getCatalog, getEvidence, InputError, resolveProcedure, search, snapshots } from './research.mjs';
import { allowedRequest, publicWebAsset, webSettings, windowLimit } from './web/security.mjs';
import { sourceRedirect } from './web/static-sources.mjs';

const web = webSettings();

const copilotEnabled = process.env.DAI_TIN_COPILOT === '1';
const copilotModule = copilotEnabled ? await import('./copilot/service.mjs') : null;
const m3Module = process.env.DAI_TIN_M3 === '1' ? await import('./copilot/m3/api.mjs') : null;

const content = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.css', ['app.css', 'text/css; charset=utf-8']],
  ['/fonts.css', ['fonts.css', 'text/css; charset=utf-8']],
  ['/public/fonts.css', ['fonts.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'application/javascript; charset=utf-8']],
  ['/brand.css', ['brand.css', 'text/css; charset=utf-8']],
  ['/public/brand.css', ['brand.css', 'text/css; charset=utf-8']],
  ['/brand/daitin.png', ['brand/daitin.png', 'image/png']],
  ['/public/brand/daitin.png', ['brand/daitin.png', 'image/png']],
  ['/mark.svg', ['brand/daitin.png', 'image/png']]
]);
const maxBodyBytes = 8192;
const publicPDFManifest = process.env.VERCEL === '1'
  ? JSON.parse(readFileSync(new URL('./copilot/sources.json', import.meta.url), 'utf8')) : null;

function respond(res, status, value, type = 'application/json; charset=utf-8', head = false, headers = {}) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));
  res.writeHead(status, {
    'Content-Type': type,
    'Content-Length': bytes.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...(web?.secure ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}),
    'Content-Security-Policy': "default-src 'self'; font-src 'self' data:; img-src 'self' data: blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    ...headers
  });
  res.end(head ? undefined : bytes);
}

async function readJSON(req, maxBytes = maxBodyBytes) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) {
    throw new InputError('Dùng định dạng application/json.');
  }
  if (req.body !== undefined) {
    try {
      const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') :
        typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      if (typeof raw !== 'string' || Buffer.byteLength(raw) > maxBytes) throw new InputError('Yêu cầu vượt quá dung lượng cho phép.');
      return JSON.parse(raw);
    } catch (error) {
      if (error instanceof InputError) throw error;
      throw new InputError('Dữ liệu gửi lên không hợp lệ.');
    }
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

export function createApp({ state = {}, modelReserved = false, immutableCopilot } = {}) {
  const copilot = immutableCopilot ?? copilotModule?.createCopilot(getCatalog(), resolveProcedure);
  const m3 = m3Module?.createM3(copilot?.review, { catalog: getCatalog(), search }, state);
  const loginLimit = windowLimit(12, 5 * 60 * 1000, 1024, state.loginLimits ?? []);
  const modelLimit = windowLimit(20, 24 * 60 * 60 * 1000, 1024, state.modelLimits ?? []);
  const handle = async (req, res) => {
    try {
      if (!allowedRequest(req, web)) {
        return respond(res, 403, { error: 'Địa chỉ truy cập hoặc nguồn yêu cầu chưa được cho phép.' });
      }
      const url = new URL(req.url, 'http://127.0.0.1');
      const path = url.pathname;
      const head = req.method === 'HEAD';
      if (web) {
        if ((req.method === 'GET' || head) && path === '/healthz') {
          return respond(res, 200, { status: 'ok' }, undefined, head);
        }
        if ((req.method === 'GET' || head) && path === '/') {
          return respond(res, 302, {}, undefined, head, { Location: '/copilot/m3/workspace/' });
        }
        const login = req.method === 'POST' && path === '/api/m5/session';
        if (login && !loginLimit(req.socket.remoteAddress ?? 'unknown')) {
          return respond(res, 429, { error: 'Đã thử đăng nhập nhiều lần. Chờ 5 phút rồi thử lại.' }, undefined, head, { 'Retry-After': '300' });
        }
        if (!login && !((req.method === 'GET' || head) && publicWebAsset(path))) {
          const actor = m3?.authorize(req);
          if (!actor) return respond(res, 401, { error: 'Cần đăng nhập Đại Tín.' }, undefined, head);
          if (req.method === 'POST' && (path === '/api/copilot/intake/run' || /\/propose$/.test(path)) &&
              !modelReserved && !modelLimit(actor.group + ':' + actor.name)) {
            return respond(res, 429, { error: 'Tài khoản đã hết 20 lượt AI trong cửa sổ 24 giờ của pilot.' }, undefined, head);
          }
        }
      }
      if (m3 && (path.startsWith('/copilot/m3') || path.startsWith('/api/m3/') || path.startsWith('/api/m4/') || path.startsWith('/api/m5/'))) {
        const result = await m3.handle(req, path, readJSON);
        if (result) return respond(res, result.status ?? 200, result.value, result.type, head, result.headers);
      }
      if (req.method === 'GET' || head) {
        if (publicPDFManifest) {
          const redirect = sourceRedirect(path, getCatalog(), publicPDFManifest);
          if (redirect) return respond(res, redirect.status,
            redirect.status === 409 ? { error: 'Bản lưu đã đổi. Mở lại đúng liên kết nguồn trong căn cứ.' } : {}, undefined, head,
            redirect.location ? { Location: redirect.location } : {});
        }
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
        const pinned = path.match(/^\/sources\/([a-z0-9-]+)\/([a-f0-9]{64})\.pdf$/);
        if (pinned && snapshots.has(pinned[1])) {
          const source = getCatalog().documents.find(item => item.id === pinned[1]);
          if (source.sha256 !== pinned[2]) return respond(res, 409,
            { error: 'Bản lưu cục bộ đã đổi. Dùng liên kết bản gốc trong căn cứ đã lưu.' }, undefined, head);
          return respond(res, 200, snapshots.get(pinned[1]), 'application/pdf', head);
        }
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
  };
  return {
    handle,
    authorize: req => m3?.authorize(req),
    state: () => ({ sessions: m3?.sessionState() ?? [], loginLimits: loginLimit.snapshot(), modelLimits: modelLimit.snapshot() }),
    close() { m3?.close(); if (!immutableCopilot) copilot?.close(); }
  };
}

export function createServer(options) {
  const app = createApp(options);
  const server = http.createServer({ requestTimeout: 10000 }, app.handle);
  server.once('close', app.close);
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 4310);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT không hợp lệ');
  const bind = process.env.DAI_TIN_BIND ?? '127.0.0.1';
  if (!['127.0.0.1', '0.0.0.0'].includes(bind) || (!web && bind !== '127.0.0.1')) {
    throw new Error('Chỉ bản web có xác thực mới được nhận kết nối ngoài máy.');
  }
  createServer().listen(port, bind, () => {
    console.log('Đại Tín • ' + (web?.origin ?? 'http://127.0.0.1:' + port));
  });
}
