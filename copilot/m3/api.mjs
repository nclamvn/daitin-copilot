import { readFileSync } from 'node:fs';
import { createDraftModel, CaseError, hash } from './workflow.mjs';
import { createCaseWorkflow, openCaseStore } from './store.mjs';
import { bindPDF, inspectPDF, maxPDF, maxRequest, pdfInput, renderPage } from '../m4/pdf.mjs';
import { makeWord, wordType } from '../m4/word.mjs';
import { pilotAccess } from '../m5/access.mjs';
import { createResearch } from '../m5/research.mjs';

const assets = new Map([
  ['/copilot/m3', ['index.html', 'text/html; charset=utf-8']],
  ['/copilot/m3/', ['index.html', 'text/html; charset=utf-8']],
  ['/copilot/m3/app.mjs', ['app.mjs', 'application/javascript; charset=utf-8']],
  ['/copilot/m3/app.css', ['app.css', 'text/css; charset=utf-8']],
  ['/copilot/m3/workspace', ['workspace/index.html', 'text/html; charset=utf-8']],
  ['/copilot/m3/workspace/', ['workspace/index.html', 'text/html; charset=utf-8']],
  ['/copilot/m3/workspace/app.mjs', ['workspace/app.mjs', 'application/javascript; charset=utf-8']],
  ['/copilot/m3/workspace/app.css', ['workspace/app.css', 'text/css; charset=utf-8']],
  ['/copilot/m3/workspace/pdf.mjs', ['workspace/pdf.mjs', 'application/javascript; charset=utf-8']],
  ['/copilot/m3/workspace/entry.js', ['workspace/entry.js', 'application/javascript; charset=utf-8']],
  ['/copilot/m3/workspace/research.mjs', ['workspace/research.mjs', 'application/javascript; charset=utf-8']]
]);

export function createM3(review, legal, state = {}) {
  if (!review) throw new Error('M3 cần bật bộ đối chiếu Copilot.');
  const model = createDraftModel();
  const m5 = process.env.DAI_TIN_M5 === '1';
  const access = m5 ? pilotAccess(process.env.DAI_TIN_M5_ACCOUNTS,
    { secure: process.env.DAI_TIN_WEB === '1' && !process.env.DAI_TIN_PUBLIC_ORIGIN?.startsWith('http:'), savedSessions: state.sessions ?? [] }) : null;
  const store = openCaseStore(process.env.DAI_TIN_M3_STORE, m5);
  const workflow = createCaseWorkflow(store, review, model);
  const research = m5 ? createResearch({ ...legal, review, templates: store.templates }) : null;
  const m4 = process.env.DAI_TIN_M4 === '1';
  return {
    close: store.close,
    authorize: req => access?.(req),
    sessionState: () => access?.snapshot() ?? [],
    async handle(req, path, readJSON) {
      const get = req.method === 'GET' || req.method === 'HEAD';
      if (get && ['/copilot/m3/workspace', '/copilot/m3/workspace/index.html'].includes(path)) {
        const query = new URL(req.url, 'http://127.0.0.1').search;
        return { status: 308, value: {}, headers: { Location: '/copilot/m3/workspace/' + query } };
      }
      const asset = assets.get(path);
      if (!m5 && path.startsWith('/api/m5/')) return null;
      if (m5 && get && ['/copilot/m3/login.css', '/copilot/m3/login.js'].includes(path)) {
        const css = path.endsWith('.css');
        return { value: readFileSync(new URL('../m5/login.' + (css ? 'css' : 'js'), import.meta.url)),
          type: css ? 'text/css; charset=utf-8' : 'application/javascript; charset=utf-8' };
      }
      if (m5 && req.method === 'POST' && path === '/api/m5/session') {
        const body = await readJSON(req);
        const cookie = access.login(body?.username, body?.key);
        return cookie ? { value: { signedIn: true }, headers: { 'Set-Cookie': cookie } } :
          { status: 401, value: { error: 'Tài khoản hoặc khóa truy cập chưa đúng.' } };
      }
      if (m5 && req.method === 'POST' && path === '/api/m5/session/logout') {
        return { value: { signedOut: true }, headers: { 'Set-Cookie': access.logout(req) } };
      }
      const actor = access?.(req);
      if (m5 && !actor) {
        if (get && ['/copilot/m3/workspace/', '/copilot/m3/workspace/index.html'].includes(path)) {
          return { value: readFileSync(new URL('../m5/login.html', import.meta.url)), type: 'text/html; charset=utf-8' };
        }
        return { status: 401, value: { error: 'Cần tài khoản pilot Đại Tín.' } };
      }
      if (get && asset) {
        return { value: readFileSync(new URL(asset[0], import.meta.url)), type: asset[1] };
      }
      const checkAccess = () => {
        if (!m5) return;
        const fresh = access(req);
        if (!fresh || fresh.group !== actor.group || fresh.role !== actor.role || fresh.name !== actor.name) {
          throw new CaseError('Quyền truy cập đã thay đổi. Mở lại với tài khoản được cấp quyền.', 403);
        }
      };
      const open = id => {
        const matter = workflow.read(id);
        if (matter.group !== actor?.group) throw new CaseError('Không tìm thấy hồ sơ.', 404);
        return matter;
      };
      const checkResearch = value => {
        if (!value || !m5) return undefined;
        const answer = research(value.input, actor);
        if (!answer.proofId || answer.proofId !== value.proofId) {
          throw new CaseError('Kết quả đã thay đổi hoặc chưa đủ căn cứ. Tra lại trước khi lưu.', 409);
        }
        return answer;
      };
      try {
        if (m5 && path.startsWith('/api/m5/')) {
          if (get && path === '/api/m5/status') return { value: { role: actor.role, name: actor.name, cutover: legal.catalog.cutover,
            model: process.env.DAI_TIN_MODEL_MODE === 'disabled' ? null : process.env.DAI_TIN_MODEL_ID,
            web: process.env.DAI_TIN_WEB === '1' } };
          if (get && path === '/api/m5/templates') return { value: store.templates.view(actor) };
          if (req.method === 'POST') {
            const body = await readJSON(req);
            checkAccess();
            if (path === '/api/m5/research') return { value: research(body, actor) };
            if (path === '/api/m5/templates/stage') return { status: 201, value: store.templates.stage(actor, body) };
            if (path === '/api/m5/templates/publish' || path === '/api/m5/templates/rollback') {
              return { value: store.templates.change(actor, path.split('/').at(-1), body) };
            }
            const pin = path.match(/^\/api\/m5\/cases\/([a-f0-9-]{36})\/research$/);
            if (pin) {
              const id = pin[1];
              open(id);
              const answer = checkResearch(body?.research);
              if (!answer) throw new CaseError('Chọn kết quả tra cứu cần lưu.');
              return { value: workflow.saveResearch(id, body.version, answer) };
            }
          }
          return null;
        }
        if (m4 && path.startsWith('/api/m4/')) {
          if (get && path === '/api/m4/status') return { value: { enabled: true, maxPDFBytes: maxPDF,
            pdfEngine: process.env.DAI_TIN_PDF_ENGINE ?? 'poppler' } };
          if (req.method === 'POST' && ['/api/m4/pdf', '/api/m4/pdf/page', '/api/m4/cases'].includes(path)) {
            const body = await readJSON(req, maxRequest);
            const bytes = pdfInput(body);
            const inspected = await inspectPDF(bytes);
            checkAccess();
            if (path === '/api/m4/pdf') return { value: inspected };
            if (path === '/api/m4/pdf/page') {
              if (body.sha256 !== inspected.sha256) throw new CaseError('Bản PDF đã thay đổi.', 409);
              const value = await renderPage(bytes, body.page, inspected.pages.length);
              checkAccess();
              return { value, type: 'image/png' };
            }
            return { status: 201, value: workflow.create(body, bindPDF(body, inspected, bytes), actor?.group,
              checkResearch(body.research)) };
          }
          const file = path.match(/^\/api\/m4\/cases\/([a-f0-9-]{36})\/(notice\.pdf|notice-page\/([1-9][0-9]*)|word\/([1-9][0-9]*)(?:\/(daitin-v2))?)$/);
          if (get && file) {
            const [, id, , page, number, layout = 'legacy'] = file;
            const matter = open(id);
            if (number) {
              const release = matter.releases.find(item => item.number === Number(number));
              if (!release) throw new CaseError('Bản duyệt này chưa tồn tại.', 404);
              const saved = store.word(id, release.number, layout) ??
                store.saveWord(id, release.number, layout, makeWord(matter, release, layout));
              if (hash(saved.bytes) !== saved.sha) throw new CaseError('Tệp Word chưa khớp dấu kiểm.', 409);
              const name = matter.reference.replaceAll('/', '-') + '-ban-duyet-' + release.number +
                (layout === 'legacy' ? '.docx' : '-daitin.docx');
              return { value: Buffer.from(saved.bytes), type: wordType,
                headers: { 'X-Artifact-SHA256': saved.sha, 'Content-Disposition': 'attachment; filename="' + name + '"' } };
            }
            const stored = store.pdf(id);
            if (!stored || !matter.document) throw new CaseError('Hồ sơ chưa có PDF.', 404);
            if (hash(stored) !== matter.document.sha256) throw new CaseError('PDF chưa khớp dấu kiểm.', 409);
            const bytes = Buffer.from(stored);
            if (page) {
              const value = await renderPage(bytes, Number(page), matter.document.pages);
              checkAccess();
              return { value, type: 'image/png' };
            }
            return { value: bytes, type: 'application/pdf', headers: { 'X-Artifact-SHA256': matter.document.sha256 } };
          }
          return null;
        }
        if (path === '/api/m3/cases') {
          if (get) return { value: workflow.list(actor?.group) };
          if (req.method === 'POST') {
            const body = await readJSON(req, 16 * 1024);
            checkAccess();
            return { status: 201, value: workflow.create(body, undefined, actor?.group, checkResearch(body?.research)) };
          }
        }
        const match = path.match(/^\/api\/m3\/cases\/([a-f0-9-]{36})(?:\/(source|propose|edit|approve|keep|release)(?:\/([1-9][0-9]*))?)?$/);
        if (!match) return null;
        const [, id, action, number] = match;
        const matter = open(id);
        if (get && !action) return { value: m5 ? { ...matter, templateChanged: workflow.templateChanged(matter),
          sourceChanged: workflow.sourceChanged(matter) } : matter };
        if (get && action === 'release' && number) {
          const release = matter.releases.find(item => item.number === Number(number));
          if (!release) throw new CaseError('Bản duyệt này chưa tồn tại.', 404);
          return { value: Buffer.from(release.markdown), type: 'text/markdown; charset=utf-8' };
        }
        if (req.method === 'POST' && action && action !== 'release' && !number) {
          const body = await readJSON(req, 16 * 1024);
          checkAccess();
          if (m5 && action === 'approve' && actor.role !== 'reviewer') throw new CaseError('Cần quyền luật sư để duyệt.', 403);
          if (action === 'approve') return { value: workflow.approve(id, body, actor) };
          if (action === 'source') return { value: workflow.addSource(id, body) };
          return { value: await workflow[action](id, body, checkAccess) };
        }
        return null;
      } catch (error) {
        if (!(error instanceof CaseError)) throw error;
        return { status: error.status, value: { error: error.message } };
      }
    }
  };
}
