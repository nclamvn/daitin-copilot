import { readFileSync } from 'node:fs';
import { createLibraryModel } from '../library/model.mjs';
import { libraryAnswer } from '../library/answer.mjs';
import { validScope } from '../library/retrieval.mjs';
import { openPrivateStore, bounded, maxSource, reviewOptions, PrivateError } from './store.mjs';
import { createHumanPilot } from './pilot.mjs';
import { planEmail, topics } from '../email/plan.mjs';
import { answerChat, buildChatDraft, validChatRequest } from '../chat/service.mjs';
import { createChatModel } from '../chat/model.mjs';
import { answerProcedure } from '../public/answer.mjs';

const json = value => ({ value });
const assets = new Map([
  ['/advice/private/', ['index.html', 'text/html; charset=utf-8']],
  ['/advice/private/app.mjs', ['app.mjs', 'application/javascript; charset=utf-8']],
  ['/advice/private/app.css', ['app.css', 'text/css; charset=utf-8']],
  ['/advice/m18-pilot.mjs', ['../ui/pilot.mjs', 'application/javascript; charset=utf-8']],
  ['/advice/pilot-rules.mjs', ['../ui/pilot-rules.mjs', 'application/javascript; charset=utf-8']],
  ['/advice/m18-review/', ['m18-review.html', 'text/html; charset=utf-8']],
  ['/advice/m18-review.mjs', ['m18-review.mjs', 'application/javascript; charset=utf-8']],
]);

export function createPrivateFeature(web, env) {
  if (env.VERCEL === '1' || env.DAI_TIN_BIND !== '127.0.0.1' ||
      new URL(web.origin).hostname !== '127.0.0.1' || env.DAI_TIN_MODEL_ENDPOINT) {
    throw new Error('Kho riêng chạy trên máy và chỉ kết nối model loopback.');
  }
  const model = createLibraryModel({ endpoint: '', port: env.DAI_TIN_MODEL_PORT,
    model: env.DAI_TIN_MODEL_ID, keyFile: env.DAI_TIN_MODEL_KEY_FILE, mode: env.DAI_TIN_MODEL_MODE, privateSources: true });
  const chatModel = createChatModel({ endpoint: '', port: env.DAI_TIN_MODEL_PORT, model: env.DAI_TIN_MODEL_ID,
    keyFile: env.DAI_TIN_MODEL_KEY_FILE, mode: env.DAI_TIN_MODEL_MODE }, { localOnly: true });
  const fingerprint = env.DAI_TIN_ADVICE_MODEL_SHA256;
  if (model && !/^[a-f0-9]{64}$/.test(fingerprint ?? '')) throw new Error('Cần dấu kiểm tệp trọng số đã khởi động.');
  const store = openPrivateStore(env.DAI_TIN_DATA_DIR);
  const pilot = createHumanPilot(store, model, model ? env.DAI_TIN_MODEL_ID + '@' + fingerprint : null);
  const group = env.DAI_TIN_ADVICE_GROUP || 'nhan-hieu';
  const isMember = actor => actor?.group === group;

  function config(actor) {
    const { version, index, rows } = store.publish();
    return { label: 'Kho nội bộ', prompts: [], scenarios: [],
      library: { documents: index.documents, passages: index.size, private: true, version },
      signedIn: true, model: Boolean(model), ...(actor?.role === 'reviewer' ? {
        chat: { owner: actor.group + ':' + actor.name, model: Boolean(chatModel) },
        emailWorkspace: { owner: actor.group + ':' + actor.name, topics, private: true,
          partners: [...new Set(rows.filter(row => row.kind === 'email' && row.scope[3] === 'poa' && row.clientText).map(row => row.issuer))].sort() },
      } : {}) };
  }

  async function handle(req, path, actor, readJSON) {
    const get = req.method === 'GET' || req.method === 'HEAD';
    const post = req.method === 'POST';
    if (!isMember(actor)) return { status: 403, value: { error: 'Kho này chỉ mở cho nhóm đã được cấp quyền.' } };
    try {
      const asset = get && assets.get(path);
      if (asset) return { value: readFileSync(new URL('./' + asset[0], import.meta.url)), type: asset[1] };
      if (get && path === '/api/advice/config') return json(config(actor));
      if (post && ['/api/advice/chat', '/api/advice/chat-locked', '/api/advice/chat-draft'].includes(path)) {
        if (actor.role !== 'reviewer') throw new PrivateError('Cần tài khoản luật sư để soạn và duyệt thư.', 403);
        if (path.endsWith('/chat-draft')) {
          const inputs = await readJSON(req, 5000);
          const draft = buildChatDraft(inputs, store.publish().rows);
          if (!draft) throw new PrivateError('Các mục cần duyệt chưa hợp lệ.');
          return json(draft);
        }
        const body = await readJSON(req, 56000);
        if (!validChatRequest(body)) throw new PrivateError('Câu hỏi hoặc dữ kiện nối tiếp chưa hợp lệ.');
        const current = store.publish();
        const result = await answerChat(body.query, body.previous ?? [], { model: path.endsWith('/chat') ? chatModel : null, rows: current.rows });
        if (store.publish().version !== current.version) throw new PrivateError('Kho vừa thay đổi. Hãy hỏi lại trên nguồn đang duyệt.', 409);
        return json(result);
      }
      if (post && path === '/api/advice/email-plan') {
        if (actor.role !== 'reviewer') throw new PrivateError('Cần tài khoản luật sư để soạn và duyệt thư.', 403);
        const input = await readJSON(req, 1024);
        const plan = planEmail(input, store.publish().rows);
        if (!plan) throw new PrivateError('Chọn thủ tục và các mục cần kiểm.');
        return json(plan);
      }
      if (post && path === '/api/advice/research') {
        const body = await readJSON(req, 4096);
        const question = bounded(body?.query, 400);
        if (body.previous != null && !validScope(body.previous)) throw new PrivateError('Phạm vi câu trước chưa hợp lệ.');
        const current = store.publish();
        const answer = await libraryAnswer(current.index, question, 'library', model, { simulation: false, previous: body.previous });
        if (store.publish().version !== current.version) throw new PrivateError('Kho vừa thay đổi. Hãy hỏi lại trên nguồn đang duyệt.', 409);
        const official = answer.kind === 'missing' && !answer.citations.length ? answerProcedure(question, body.previous) : null;
        return json({ ...(official ?? answer), sourceVersion: current.version });
      }
      const source = get && path.match(/^\/api\/advice\/source\/(r-[a-f0-9]+-\d+)$/)?.[1];
      if (source) {
        const item = store.file(source);
        return { value: item.bytes, type: 'application/octet-stream',
          headers: { 'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(item.name).replace(/['()]/g, c => '%' + c.charCodeAt(0).toString(16)) } };
      }
      const base = '/api/advice/private/';
      if (get && path === base + 'library') {
        const current = store.publish();
        return json({ account: actor.name, reviewer: actor.role === 'reviewer', options: reviewOptions,
          docs: store.list(), version: current.version,
          approved: current.rows.map(({ id, title, scope, paragraph }) => ({ id, title, scope, paragraph })),
          pilots: pilot.list(actor) });
      }
      const doc = get && path.match(/^\/api\/advice\/private\/document\/([a-f0-9]{64})$/)?.[1];
      if (doc) {
        const params = new URL(req.url, 'http://127.0.0.1').searchParams;
        const offset = Number(params.get('offset') ?? 0);
        if (!Number.isSafeInteger(offset) || offset < 0 || offset > 30000) throw new PrivateError('Vị trí đọc đoạn không hợp lệ.');
        const term = params.get('q')?.slice(0, 200) ?? '';
        return json(store.document(doc, offset, term));
      }
      if (post && path === base + 'import') {
        const body = await readJSON(req, Math.ceil(maxSource / 3) * 4 + 8192);
        return json(await store.importFile(body, actor.name));
      }
      if (post && [base + 'approve', base + 'withdraw'].includes(path)) {
        if (actor.role !== 'reviewer') throw new PrivateError('Cần tài khoản luật sư để duyệt nguồn.', 403);
        const body = await readJSON(req, 8192);
        return json(path.endsWith('/approve') ? store.approve(body, actor.name) : store.withdraw(body.id, actor.name));
      }
      if (post && path === base + 'pilot') return json(pilot.create(await readJSON(req, 12000), actor));
      const operation = path.match(/^\/api\/advice\/private\/pilot\/([a-f0-9]{24})(?:\/(act|blind|grade|report|source))?$/);
      if (operation) {
        const [, id, action] = operation;
        if (get && !action) return json(pilot.detail(id, actor));
        if (get && action === 'blind') return json(pilot.blind(id, actor));
        if (get && action === 'report') return json(pilot.report(id, actor));
        if (get && action === 'source') {
          return json(pilot.source(id, actor, new URL(req.url, 'http://127.0.0.1').searchParams.get('id')));
        }
        if (post && action === 'act') return json(await pilot.act(id, await readJSON(req, 24000), actor));
        if (post && action === 'grade') return json(pilot.grade(id, await readJSON(req, 90000), actor));
      }
      return null;
    } catch (error) {
      if (error instanceof PrivateError) return { status: error.status, value: { error: error.message } };
      throw error;
    }
  }

  return { isMember, config, handle };
}
