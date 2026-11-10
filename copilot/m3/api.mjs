import { readFileSync } from 'node:fs';
import { createDraftModel, CaseError, hash } from './workflow.mjs';
import { createCaseWorkflow, openCaseStore } from './store.mjs';
import { bindPDF, inspectPDF, maxRequest, pdfInput, renderPage } from '../m4/pdf.mjs';
import { makeWord, wordType } from '../m4/word.mjs';

const assets = new Map([
  ['/copilot/m3', ['index.html', 'text/html; charset=utf-8']],
  ['/copilot/m3/', ['index.html', 'text/html; charset=utf-8']],
  ['/copilot/m3/app.mjs', ['app.mjs', 'application/javascript; charset=utf-8']],
  ['/copilot/m3/app.css', ['app.css', 'text/css; charset=utf-8']],
  ['/copilot/m3/workspace', ['workspace/index.html', 'text/html; charset=utf-8']],
  ['/copilot/m3/workspace/', ['workspace/index.html', 'text/html; charset=utf-8']],
  ['/copilot/m3/workspace/app.mjs', ['workspace/app.mjs', 'application/javascript; charset=utf-8']],
  ['/copilot/m3/workspace/app.css', ['workspace/app.css', 'text/css; charset=utf-8']],
  ['/copilot/m3/workspace/pdf.mjs', ['workspace/pdf.mjs', 'application/javascript; charset=utf-8']]
]);

export function createM3(review) {
  if (!review) throw new Error('M3 cần bật bộ đối chiếu Copilot.');
  const model = createDraftModel();
  const store = openCaseStore(process.env.DAI_TIN_M3_STORE);
  const workflow = createCaseWorkflow(store, review, model);
  const m4 = process.env.DAI_TIN_M4 === '1';
  return {
    close: store.close,
    async handle(req, path, readJSON) {
      const get = req.method === 'GET' || req.method === 'HEAD';
      const asset = assets.get(path);
      if (get && asset) {
        return { value: readFileSync(new URL(asset[0], import.meta.url)), type: asset[1] };
      }
      try {
        if (m4 && path.startsWith('/api/m4/')) {
          if (get && path === '/api/m4/status') return { value: { enabled: true } };
          if (req.method === 'POST' && ['/api/m4/pdf', '/api/m4/pdf/page', '/api/m4/cases'].includes(path)) {
            const body = await readJSON(req, maxRequest);
            const bytes = pdfInput(body);
            const inspected = await inspectPDF(bytes);
            if (path === '/api/m4/pdf') return { value: inspected };
            if (path === '/api/m4/pdf/page') {
              if (body.sha256 !== inspected.sha256) throw new CaseError('Bản PDF đã thay đổi.', 409);
              return { value: await renderPage(bytes, body.page, inspected.pages.length), type: 'image/png' };
            }
            return { status: 201, value: workflow.create(body, bindPDF(body, inspected, bytes)) };
          }
          const file = path.match(/^\/api\/m4\/cases\/([a-f0-9-]{36})\/(notice\.pdf|notice-page\/([1-9][0-9]*)|word\/([1-9][0-9]*))$/);
          if (get && file) {
            const [, id, asset, page, number] = file;
            const matter = workflow.read(id);
            if (number) {
              const release = matter.releases.find(item => item.number === Number(number));
              if (!release) throw new CaseError('Bản duyệt này chưa tồn tại.', 404);
              const saved = store.word(id, release.number) ?? store.saveWord(id, release.number, makeWord(matter, release));
              if (hash(saved.bytes) !== saved.sha) throw new CaseError('Tệp Word chưa khớp dấu kiểm.', 409);
              const name = matter.reference.replaceAll('/', '-') + '-ban-duyet-' + release.number + '.docx';
              return { value: Buffer.from(saved.bytes), type: wordType,
                headers: { 'X-Artifact-SHA256': saved.sha, 'Content-Disposition': 'attachment; filename="' + name + '"' } };
            }
            const stored = store.pdf(id);
            if (!stored || !matter.document) throw new CaseError('Hồ sơ chưa có PDF.', 404);
            if (hash(stored) !== matter.document.sha256) throw new CaseError('PDF chưa khớp dấu kiểm.', 409);
            const bytes = Buffer.from(stored);
            return page ? { value: await renderPage(bytes, Number(page), matter.document.pages), type: 'image/png' }
              : { value: bytes, type: 'application/pdf', headers: { 'X-Artifact-SHA256': matter.document.sha256 } };
          }
          return null;
        }
        if (path === '/api/m3/cases') {
          if (get) return { value: workflow.list() };
          if (req.method === 'POST') return { status: 201, value: workflow.create(await readJSON(req, 16 * 1024)) };
        }
        const match = path.match(/^\/api\/m3\/cases\/([a-f0-9-]{36})(?:\/(source|propose|edit|approve|keep|release)(?:\/([1-9][0-9]*))?)?$/);
        if (!match) return null;
        const [, id, action, number] = match;
        if (get && !action) return { value: workflow.read(id) };
        if (get && action === 'release' && number) {
          const release = workflow.read(id).releases.find(item => item.number === Number(number));
          if (!release) throw new CaseError('Bản duyệt này chưa tồn tại.', 404);
          return { value: Buffer.from(release.markdown), type: 'text/markdown; charset=utf-8' };
        }
        if (req.method === 'POST' && action && action !== 'release' && !number) {
          const body = await readJSON(req, 16 * 1024);
          if (action === 'source') return { value: workflow.addSource(id, body) };
          return { value: await workflow[action](id, body) };
        }
        return null;
      } catch (error) {
        if (!(error instanceof CaseError)) throw error;
        return { status: error.status, value: { error: error.message } };
      }
    }
  };
}
