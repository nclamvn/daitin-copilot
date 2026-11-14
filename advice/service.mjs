import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { answerAdvice, prompts, scenarios } from './engine.mjs';
import { demoWord, simulatedMail } from './demo.mjs';
import { createIndex, validScope } from './library/retrieval.mjs';
import { createLibraryModel } from './library/model.mjs';
import { libraryAnswer } from './library/answer.mjs';
import { planEmail, topics as emailTopics } from './email/plan.mjs';
import { answerProcedure } from './public/answer.mjs';
import { createPrivateFeature } from './private/service.mjs';

const publicPrompts = [
  'Gia hạn nhãn hiệu Việt Nam nộp qua đại diện có cần POA không?',
  'Niên phí sáng chế Thái Lan dùng mẫu nào và có cần POA?',
  'Gia hạn nhãn hiệu Việt Nam cần hồ sơ gì và hạn nộp khi nào?',
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
  ['/advice/email.mjs', ['email.mjs', 'application/javascript; charset=utf-8']],
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
  const privateFeature = env.DAI_TIN_ADVICE_MODE === 'private' ? createPrivateFeature(web, env) : null;
  const word = demo ? demoWord : privateFeature ? [] : loadReviewedWord(env.DAI_TIN_ADVICE_WORD, env.DAI_TIN_ADVICE_REVIEW);
  const library = demo && env.DAI_TIN_ADVICE_RAG === '1'
    ? createIndex(JSON.parse(readFileSync(new URL('./library/index.json', import.meta.url), 'utf8'))) : null;
  const publicIndex = library ? createIndex(
    JSON.parse(readFileSync(new URL('./library/public-index.json', import.meta.url), 'utf8')), { privateLibrary: true }) : null;
  const model = library ? createLibraryModel({
    port: env.DAI_TIN_MODEL_PORT, model: env.DAI_TIN_MODEL_ID, keyFile: env.DAI_TIN_MODEL_KEY_FILE,
    endpoint: env.DAI_TIN_MODEL_ENDPOINT, mode: env.DAI_TIN_MODEL_MODE,
  }) : null;
  const config = {
    label: demo ? 'Dữ liệu mô phỏng' : 'Nguồn nội bộ', prompts: publicIndex ? publicPrompts : prompts,
    scenarios: publicIndex ? [{ id: 'public', label: 'Nguồn công khai' }, { id: 'library', label: 'Kho mô phỏng' }, ...scenarios] : scenarios,
    ...(publicIndex ? { defaultScenario: 'public',
      library: { documents: library.documents, passages: library.size, publicDocuments: publicIndex.documents, publicProcedures: 2 },
      model: Boolean(model) } : {}),
    signedIn: true,
  };
  const pageTemplate = readFileSync(new URL('./ui/index.html', import.meta.url), 'utf8');
  const indexPage = settings => pageTemplate.replace('id="advice-config">{}',
    () => 'id="advice-config">' + JSON.stringify(settings).replaceAll('<', '\\u003c'));
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
    if (privateFeature && privateFeature.isMember(actor)) {
      if (get && path === '/advice/') return { value: Buffer.from(indexPage(privateFeature.config(actor))), type: 'text/html; charset=utf-8' };
      if (get && path === '/advice') return { status: 308, value: {}, headers: { Location: '/advice/' } };
      if (!assets.has(path)) return privateFeature.handle(req, path, actor, readJSON);
    }
    if (privateFeature ? !privateFeature.isMember(actor) : actor?.role !== 'reviewer') {
      return { status: actor ? 403 : 401, value: { error: 'Cần tài khoản luật sư được cấp quyền hỏi đáp nghiệp vụ.' } };
    }
    if (get && path === '/advice') return { status: 308, value: {}, headers: { Location: '/advice/' } };
    if (get && path === '/advice/') return { value: Buffer.from(indexPage(publicIndex ? { ...config, emailWorkspace: { owner: actor.group + ':' + actor.name, topics: emailTopics } } : config)), type: 'text/html; charset=utf-8' };
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
    if (req.method === 'POST' && publicIndex && path === '/api/advice/email-plan') {
      const plan = planEmail(await readJSON(req, 1024));
      return plan ? { value: plan } : { status: 400, value: { error: 'Chọn thủ tục và các mục cần kiểm.' } };
    }
    if (req.method === 'POST' && library && ['/api/advice/research', '/api/advice/public'].includes(path)) {
      const published = path === '/api/advice/public';
      const body = await readJSON(req, 4096);
      if (typeof body?.query !== 'string' || !body.query.trim() || body.query.length > 400 ||
          (body.previous != null && !validScope(body.previous)) ||
          (published ? body.scenario !== 'public' :
            body.scenario === 'public' || !config.scenarios.some(option => option.id === body.scenario))) {
        return { status: 400, value: { error: 'Câu hỏi hoặc tình huống nguồn chưa hợp lệ.' } };
      }
      const procedure = published ? answerProcedure(body.query, body.previous) : null;
      if (procedure) return { value: procedure };
      return { value: await libraryAnswer(published ? publicIndex : library, body.query,
        published ? 'library' : body.scenario, published ? null : model,
        { previous: body.previous, simulation: !published, downloads: !published }) };
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
