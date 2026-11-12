import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { answerAdvice, prompts, scenarios } from './engine.mjs';
import { demoWord, simulatedMail } from './demo.mjs';
import { createIndex } from './library/retrieval.mjs';
import { createLibraryModel } from './library/model.mjs';
import { libraryAnswer } from './library/answer.mjs';

const libraryPrompts = [...prompts,
  'Gia hạn nhãn hiệu tại Singapore có thể dùng lại POA cũ không?',
  'Nộp đơn kiểu dáng tại Malaysia cần chuẩn bị gì?',
];
const fileHash = /^[a-f0-9]{64}$/;
const sha = text => createHash('sha256').update(text).digest('hex');
const project = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const topicsBySource = new Map([
  ['word-vn-renewal', 'vn-renewal'],
  ['word-th-registration', 'th-annuity'],
]);
const assets = new Map([
  ['/advice/app.css', ['app.css', 'text/css; charset=utf-8']],
  ['/advice/app.mjs', ['app.mjs', 'application/javascript; charset=utf-8']],
]);

function readPrivateJson(file) {
  if (!isAbsolute(file ?? '')) throw new Error('M9 cần đường dẫn tuyệt đối cho nguồn nội bộ.');
  const resolved = realpathSync(file);
  const local = relative(project, resolved);
  const metadata = statSync(resolved);
  if (!local.startsWith('..' + sep) || !metadata.isFile() || metadata.size > 16384 ||
      metadata.uid !== process.getuid() || (metadata.mode & 0o077)) {
    throw new Error('Nguồn Word M9 cần lưu ngoài kho mã với quyền 0600.');
  }
  return JSON.parse(readFileSync(resolved, 'utf8'));
}

function loadReviewedWord(file, reviewFile) {
  const review = readPrivateJson(reviewFile);
  const snapshot = readPrivateJson(file);
  if (review?.schema !== 1 || snapshot?.schema !== 1 || !fileHash.test(review.wordSha256 ?? '') ||
      snapshot.wordSha256 !== review.wordSha256 || typeof review.title !== 'string' ||
      !Array.isArray(review.sources) || review.sources.length !== topicsBySource.size ||
      !Array.isArray(snapshot.sources) || snapshot.sources.length !== topicsBySource.size) {
    throw new Error('Phiên bản ảnh chụp Word chưa được khóa cho M9.');
  }
  return [...topicsBySource].map(([id, topic]) => {
    const rule = review.sources.find(item => item?.id === id);
    const row = snapshot.sources.find(item => item?.id === id);
    if (!rule || !row || rule.topic !== topic || row.topic !== topic ||
        !Number.isSafeInteger(rule.paragraph) || rule.paragraph < 1 || row.paragraph !== rule.paragraph ||
        typeof rule.anchor !== 'string' || !fileHash.test(rule.quoteSha256 ?? '') ||
        typeof row.quote !== 'string' || row.quoteSha256 !== rule.quoteSha256 || sha(row.quote) !== rule.quoteSha256) {
      throw new Error('Đoạn Word đã đổi. Cần đối chiếu lại trước khi đưa vào kho.');
    }
    if (topic === 'vn-renewal' ? rule.position !== 'signed' ||
        ![rule.answerTitle, rule.answerText, rule.emailText].every(value => typeof value === 'string' && value.trim())
        : rule.position !== null || typeof rule.note !== 'string') {
      throw new Error('Thiếu kết quả đối chiếu nghiệp vụ của đoạn Word.');
    }
    return {
      id, topic, kind: 'word', simulated: false, date: null, position: rule.position,
      title: review.title, anchor: rule.anchor + ' · Đoạn Word ' + rule.paragraph, quote: row.quote,
      answerTitle: rule.answerTitle, answerText: rule.answerText, emailText: rule.emailText, note: rule.note,
    };
  });
}

export function createAdvice(web, env = process.env) {
  const demo = env.DAI_TIN_ADVICE_MODE === 'demo';
  if (!web) throw new Error('M9 cần bản web có xác thực.');
  if (!demo && (env.VERCEL === '1' || env.DAI_TIN_BIND !== '127.0.0.1' ||
      new URL(web.origin).hostname !== '127.0.0.1')) {
    throw new Error('Nguồn Word M9 chỉ chạy trong bản web xác thực trên loopback.');
  }
  const word = demo ? demoWord : loadReviewedWord(env.DAI_TIN_ADVICE_WORD, env.DAI_TIN_ADVICE_REVIEW);
  const library = demo && env.DAI_TIN_ADVICE_RAG === '1'
    ? createIndex(JSON.parse(readFileSync(new URL('./library/index.json', import.meta.url), 'utf8'))) : null;
  const model = library ? createLibraryModel({
    port: env.DAI_TIN_MODEL_PORT, model: env.DAI_TIN_MODEL_ID, keyFile: env.DAI_TIN_MODEL_KEY_FILE,
    endpoint: env.DAI_TIN_MODEL_ENDPOINT, mode: env.DAI_TIN_MODEL_MODE,
  }) : null;
  const config = {
    label: demo ? 'Dữ liệu mô phỏng' : 'Nguồn nội bộ', prompts: library ? libraryPrompts : prompts,
    scenarios: library ? [{ id: 'library', label: 'Kho mô phỏng' }, ...scenarios] : scenarios,
    ...(library ? { library: { documents: library.documents, passages: library.size }, model: Boolean(model) } : {}),
    signedIn: true,
  };
  const indexPage = readFileSync(new URL('./ui/index.html', import.meta.url), 'utf8')
    .replace('id="advice-config">{}', () => 'id="advice-config">' + JSON.stringify(config).replaceAll('<', '\\u003c'));
  return async function handleAdvice(req, path, actor, readJSON) {
    const get = req.method === 'GET' || req.method === 'HEAD';
    const entry = get && (path === '/advice' || path === '/advice/');
    if (!actor && entry) {
      const login = readFileSync(new URL('../copilot/m5/login.html', import.meta.url), 'utf8')
        .replace('data-return-to="/copilot/m3/workspace/"', 'data-return-to="/advice/"')
        .replace('Đăng nhập để mở hồ sơ, đối chiếu căn cứ và tiếp tục từ bản đã lưu.',
          'Đăng nhập để tra cứu hướng dẫn nghiệp vụ và mở đúng đoạn nguồn.')
        .replace('Mở Bàn hồ sơ', 'Mở Hỏi đáp nghiệp vụ');
      return { value: Buffer.from(login), type: 'text/html; charset=utf-8' };
    }
    if (actor?.role !== 'reviewer') {
      return { status: actor ? 403 : 401, value: { error: 'Cần tài khoản luật sư được cấp quyền hỏi đáp nghiệp vụ.' } };
    }
    if (get && path === '/advice') return { status: 308, value: {}, headers: { Location: '/advice/' } };
    if (get && path === '/advice/') return { value: Buffer.from(indexPage), type: 'text/html; charset=utf-8' };
    const asset = get && assets.get(path);
    if (asset) {
      return { value: readFileSync(new URL('./ui/' + asset[0], import.meta.url)), type: asset[1] };
    }
    const sourceId = get && path.match(/^\/api\/advice\/source\/([a-z0-9-]{1,80})$/)?.[1];
    if (library && sourceId) {
      const source = library.source(sourceId);
      if (!source) return { status: 404, value: { error: 'Không tìm được tài liệu trong kho.' } };
      const bytes = readFileSync(new URL('./library/fixtures/' + source.file, import.meta.url));
      if (sha(bytes) !== source.sha256) return { status: 409, value: { error: 'Tài liệu đã đổi so với đoạn dẫn.' } };
      return { value: bytes, type: 'application/octet-stream', headers: {
        'Content-Disposition': 'attachment; filename="' + source.file + '"',
      } };
    }
    if (get && path === '/api/advice/config') {
      return { value: config };
    }
    if (req.method === 'POST' && library && path === '/api/advice/research') {
      const body = await readJSON(req, 4096);
      if (typeof body?.query !== 'string' || !body.query.trim() || body.query.length > 400 ||
          (body.scenario !== 'library' && !scenarios.some(option => option.id === body.scenario))) {
        return { status: 400, value: { error: 'Câu hỏi hoặc tình huống nguồn chưa hợp lệ.' } };
      }
      return { value: await libraryAnswer(library, body.query, body.scenario, model) };
    }
    if (req.method === 'POST' && path === '/api/advice/ask') {
      const body = await readJSON(req, 4096);
      if (typeof body?.query !== 'string' || !body.query.trim() || body.query.length > 400 ||
          !scenarios.some(option => option.id === body.scenario)) {
        return { status: 400, value: { error: 'Câu hỏi hoặc tình huống nguồn chưa hợp lệ.' } };
      }
      return { value: answerAdvice(body.query, word, simulatedMail, body.scenario, demo) };
    }
    return null;
  };
}
