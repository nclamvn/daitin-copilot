import http from 'node:http';
import { isIP } from 'node:net';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pilotAccess } from '../../copilot/m5/access.mjs';
import { windowLimit } from '../../web/security.mjs';
import { createLibraryModel } from '../library/model.mjs';
import { digest, openPrivateStore, PrivateError } from './store.mjs';
import { createHumanPilot } from './pilot.mjs';

const [directory, publicURL, portText = '4345'] = process.argv.slice(2);
const front = new URL(publicURL);
const railway = process.env.DAI_TIN_PUBLIC_PILOT_PLATFORM === 'railway';
const matchedHost = railway
  ? front.hostname === process.env.RAILWAY_PUBLIC_DOMAIN && /^[a-z0-9-]+\.up\.railway\.app$/.test(front.hostname)
  : /^[a-z0-9-]+\.trycloudflare\.com$/.test(front.hostname);
if (front.protocol !== 'https:' || front.pathname !== '/' || front.port || front.search || front.hash ||
    front.username || front.password || !matchedHost) {
  throw new Error('Cần đúng URL HTTPS của dịch vụ pilot.');
}
const port = Number(portText);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('Cổng pilot không hợp lệ.');
const root = resolve(directory);
const store = openPrivateStore(root);
const releasePath = resolve(root, 'release.json');
if (statSync(releasePath).mode & 0o077) throw new Error('Biên nhận phát hành phải có quyền 0600.');
const release = JSON.parse(readFileSync(releasePath, 'utf8'));
if (!/^[a-f0-9]{24}$/.test(release.plan) || !Array.isArray(release.documents) || !Array.isArray(release.approved)) {
  throw new Error('Biên nhận pilot không hợp lệ.');
}
const profile = process.env.DAI_TIN_MODEL_ID + '@' + process.env.DAI_TIN_ADVICE_MODEL_SHA256;
if (profile !== release.modelKey || process.env.DAI_TIN_MODEL_ENDPOINT || process.env.VERCEL === '1') {
  throw new Error('Pilot yêu cầu đúng model đã khóa trên máy.');
}
const modelTimeoutMs = railway ? 115000 : 16000;
const model = createLibraryModel({ endpoint: '', mode: 'enabled', privateSources: true, timeoutMs: modelTimeoutMs });
if (!model) throw new Error('Model cục bộ chưa có.');
const pilot = createHumanPilot(store, model, profile, Date.now, modelTimeoutMs + 9000);
const allowed = new Set(['binh', 'cham-mu']);
const authorize = pilotAccess(resolve(root, 'accounts.json'), { secure: true });
const loginLimit = windowLimit(10, 5 * 60 * 1000);
const base = '/api/advice/private/pilot/' + release.plan;
const loginPage = readFileSync(new URL('../../copilot/m5/login.html', import.meta.url), 'utf8')
  .replace('Đại Tín | Đăng nhập Bàn hồ sơ', 'Đại Tín | Đăng nhập pilot')
  .replace('Bàn hồ sơ sở hữu trí tuệ', 'Pilot nguồn công khai')
  .replace('Đăng nhập để mở hồ sơ, đối chiếu căn cứ và tiếp tục từ bản đã lưu.',
    'Đăng nhập để chạy hai nhánh trên cùng bộ nguồn công khai đã khóa.')
  .replace('data-return-to="/copilot/m3/workspace/"', 'data-return-to="/pilot"')
  .replace('Mở Bàn hồ sơ', 'Mở pilot')
  .replace('Dùng tài khoản đã được cấp cho nhóm. Hồ sơ và bản duyệt được lưu tại dịch vụ Đại Tín đang truy cập.',
    'Dùng khóa đã cấp riêng. Chỉ dùng câu hỏi pilot và thông tin công khai trong phiên.');
const operatorPage = readFileSync(new URL('./index.html', import.meta.url), 'utf8')
  .replace('<title>Đại Tín · Kho nguồn nội bộ</title>', '<title>Đại Tín · Pilot hai nhánh</title>\n  <meta name="pilot-invitation" content="' + release.plan + '">')
  .replace('Hai nhánh dùng cùng câu hỏi, model và bộ đoạn đã khóa. Đồng hồ tách thời gian chờ model.',
    'Hai nhánh dùng cùng câu hỏi, model và bộ đoạn công khai đã khóa. Đồng hồ tách thời gian chờ model.');
const assets = new Map([
  ['/fonts.css', ['../../public/fonts.css', 'text/css']],
  ['/public/fonts.css', ['../../public/fonts.css', 'text/css']],
  ['/brand.css', ['../../public/brand.css', 'text/css']],
  ['/brand/daitin.png', ['../../public/brand/daitin.png', 'image/png']],
  ['/public/brand/daitin.png', ['../../public/brand/daitin.png', 'image/png']],
  ['/copilot/m3/login.css', ['../../copilot/m5/login.css', 'text/css']],
  ['/copilot/m3/login.js', ['../../copilot/m5/login.js', 'application/javascript']],
  ['/advice/private/app.css', ['./app.css', 'text/css']],
  ['/advice/private/app.mjs', ['./app.mjs', 'application/javascript']],
].map(([path, [file, type]]) => [path, { value: readFileSync(new URL(file, import.meta.url)), type }]));

function verifyRelease() {
  const current = store.publish();
  const docs = store.list().map(row => row.sha).sort();
  if (current.version !== release.version ||
      JSON.stringify(docs) !== JSON.stringify(release.documents) ||
      JSON.stringify(current.rows.map(row => row.id).sort()) !== JSON.stringify(release.approved) ||
      !current.rows.length || current.rows.some(row => !row.origin)) {
    throw new PrivateError('Bộ nguồn công khai đã đổi. Phiên tạm đóng.', 409);
  }
  const plan = pilot.detail(release.plan, { name: 'binh' });
  if (plan.version !== release.version || plan.sourceHash !== release.sourceHash ||
      digest(JSON.stringify(plan.questions)) !== release.questionsHash || plan.grader !== 'cham-mu' ||
      plan.operator !== 'binh' || plan.modelKey !== profile || plan.mode !== 'human') {
    throw new PrivateError('Đợt pilot không khớp biên nhận.', 409);
  }
}

async function readJSON(req, limit) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) throw new PrivateError('Cần application/json.');
  let size = 0;
  const chunks = [];
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > limit) {
      req.resume();
      throw new PrivateError('Yêu cầu vượt dung lượng.', 413);
    }
    chunks.push(chunk);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch { throw new PrivateError('Dữ liệu gửi lên không hợp lệ.'); }
}

function send(res, status, value, type = 'application/json', headers = {}) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(type === 'application/json' ? JSON.stringify(value) : value);
  res.writeHead(status, {
    'Content-Type': type.startsWith('image/') ? type : type + '; charset=utf-8',
    'Content-Length': bytes.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow',
    'Content-Security-Policy': "default-src 'self'; font-src 'self' data:; img-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    'Strict-Transport-Security': 'max-age=31536000',
    ...headers,
  });
  res.end(res.req.method === 'HEAD' ? undefined : bytes);
}

verifyRelease();
const server = http.createServer({ requestTimeout: 12000 }, async (req, res) => {
  try {
    const post = req.method === 'POST';
    const get = ['GET', 'HEAD'].includes(req.method);
    if (get && req.url === '/healthz' && (req.headers.host === front.host || (railway && req.headers.host === 'healthcheck.railway.app'))) {
      verifyRelease();
      return send(res, 200, { status: 'ok' });
    }
    if (req.headers.host !== front.host || (req.headers.origin && req.headers.origin !== front.origin) ||
        (post && (req.headers.origin !== front.origin || req.headers['sec-fetch-site'] === 'cross-site'))) {
      return send(res, 403, { error: 'Địa chỉ hoặc nguồn yêu cầu chưa được phép.' });
    }
    const url = new URL(req.url, front);
    const path = url.pathname;
    if (get && path === '/') return send(res, 302, {}, undefined, { Location: '/pilot' });
    if (get && assets.has(path)) {
      const asset = assets.get(path);
      return send(res, 200, asset.value, asset.type);
    }
    if (post && path === '/api/m5/session') {
      const ip = railway ? req.headers['x-real-ip'] : req.headers['cf-connecting-ip'];
      if (!loginLimit(typeof ip === 'string' && isIP(ip) ? ip : 'local')) {
        return send(res, 429, { error: 'Chờ 5 phút trước khi thử đăng nhập lại.' });
      }
      const body = await readJSON(req, 4096);
      const cookie = allowed.has(body.username) && authorize.login(body.username, body.key);
      if (!cookie) return send(res, 401, { error: 'Tài khoản hoặc khóa truy cập chưa đúng.' });
      return send(res, 200, { signedIn: true }, undefined, { 'Set-Cookie': cookie });
    }
    if (post && path === '/api/m5/session/logout') {
      return send(res, 200, { signedOut: true }, undefined, { 'Set-Cookie': authorize.logout(req) });
    }
    const actor = authorize({ headers: { cookie: req.headers.cookie } });
    const hasAccess = allowed.has(actor?.name);
    if (get && path === '/pilot') {
      if (hasAccess) verifyRelease();
      return send(res, 200, hasAccess ? operatorPage : loginPage, 'text/html');
    }
    if (![base, base + '/source', base + '/blind', base + '/grade', base + '/act', base + '/report'].includes(path)) {
      return send(res, 404, { error: 'Đường dẫn ngoài phạm vi pilot.' });
    }
    if (!hasAccess) return send(res, 401, { error: 'Cần đăng nhập pilot.' });
    verifyRelease();
    if (get && path === base) return send(res, 200, pilot.detail(release.plan, actor));
    if (get && path === base + '/source') return send(res, 200, pilot.source(release.plan, actor, url.searchParams.get('id')));
    if (get && path === base + '/blind') return send(res, 200, pilot.blind(release.plan, actor));
    if (get && path === base + '/report') return send(res, 200, pilot.report(release.plan, actor));
    if (post && path === base + '/grade') return send(res, 200, pilot.grade(release.plan, await readJSON(req, 90000), actor));
    if (post && path === base + '/act') return send(res, 200, await pilot.act(release.plan, await readJSON(req, 24000), actor));
    return send(res, 405, { error: 'Phương thức không phù hợp.' });
  } catch (error) {
    if (error instanceof PrivateError) return send(res, error.status, { error: error.message });
    console.error('Pilot request failed:', error.name);
    return send(res, 500, { error: 'Tạm thời chưa xử lý được yêu cầu.' });
  }
});
server.listen(port, railway ? '0.0.0.0' : '127.0.0.1', () => console.log('Public-source pilot at ' + front.origin + '/pilot'));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => store.close()));
