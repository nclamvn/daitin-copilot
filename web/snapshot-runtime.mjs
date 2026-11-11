import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pilotAccess } from '../copilot/m5/access.mjs';
import { windowLimit } from './security.mjs';

export const snapshotPath = 'pilot/state-v1.json';
export const maxSnapshotBytes = 16 * 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sqliteHeader = Buffer.from('SQLite format 3\0');

export class SnapshotError extends Error {
  constructor(message, status = 503) { super(message); this.status = status; }
}

export function makeSnapshot(database, auth = {}) {
  return { schema: 1, database: Buffer.from(database).toString('base64'), databaseSHA256: hash(database),
    sessions: auth.sessions ?? [], loginLimits: auth.loginLimits ?? [], modelLimits: auth.modelLimits ?? [],
    audit: auth.audit ?? [], accounts: auth.accounts ?? [], lease: null };
}

export function inspectSnapshot(state) {
  if (!state || state.schema !== 1 || typeof state.database !== 'string' ||
      !/^[a-f0-9]{64}$/.test(state.databaseSHA256 ?? '') ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(state.database) || state.database.length % 4 ||
      !Array.isArray(state.audit) || state.audit.length > 200 ||
      (state.lease && (typeof state.lease.id !== 'string' || !Number.isSafeInteger(state.lease.until)))) {
    throw new SnapshotError('Kho pilot chưa đúng định dạng. Không tự thay bằng bộ dữ liệu mới.');
  }
  if (state.accounts !== undefined && (!Array.isArray(state.accounts) || state.accounts.length > 32 ||
      new Set(state.accounts.map(item => item?.name)).size !== state.accounts.length || state.accounts.some(item =>
        !/^[a-z][a-z0-9-]{0,29}$/.test(item?.name ?? '') || !/^[a-z][a-z0-9-]{0,29}$/.test(item?.group ?? '') ||
        !/^[a-f0-9]{64}$/.test(item?.key ?? '') || !['reviewer', 'editor'].includes(item?.role)))) {
    throw new SnapshotError('Cấu hình tài khoản trong kho pilot chưa hợp lệ.');
  }
  if (Buffer.byteLength(JSON.stringify(state)) > maxSnapshotBytes) throw new SnapshotError('Kho pilot vượt dung lượng cho phép.', 413);
  const database = Buffer.from(state.database, 'base64');
  if (!database.subarray(0, 16).equals(sqliteHeader) || hash(database) !== state.databaseSHA256) {
    throw new SnapshotError('Dấu kiểm kho hồ sơ không khớp. Cần khôi phục bản đã lưu.');
  }
  return database;
}

function bufferedResponse() {
  let status = 200;
  let headers = {};
  let ended = false;
  const chunks = [];
  return {
    writeHead(code, fields = {}) { status = code; headers = { ...fields }; },
    end(value) { if (value !== undefined) chunks.push(Buffer.from(value)); ended = true; },
    result() {
      if (!ended) throw new Error('Application did not complete its response');
      return { status, headers, body: Buffer.concat(chunks) };
    }
  };
}

function send(res, reply) {
  res.writeHead(reply.status, reply.headers);
  res.end(reply.body);
}

function failure(res, error) {
  const status = error instanceof SnapshotError ? error.status : 503;
  const message = error instanceof SnapshotError ? error.message : 'Chưa lưu được trạng thái pilot. Bản đã lưu vẫn được giữ; hãy mở lại hồ sơ để kiểm tra trước khi thử tiếp.';
  const body = Buffer.from(JSON.stringify({ error: message }));
  send(res, { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length,
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }, body });
}

const isModelPath = pathname => pathname === '/api/copilot/intake/run' ||
  /^\/api\/(?:m3|patents)\/cases\/[a-f0-9-]{36}\/propose$/.test(pathname);
const isReadOnlyPostPath = pathname => ['/api/patents/search', '/api/patents/pdf-pack/inspect', '/api/patents/pdf-pack/preview'].includes(pathname) ||
  /^\/api\/patents\/cases\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/pdf\/(?:inspect|preview)$/.test(pathname);

// The SQLite file is a request workspace, never the durable store. A single
// private-Blob conditional write publishes DB, sessions and counters together.
export function createSnapshotRuntime({ store, run, accounts, preflight = () => true, temporaryRoot = tmpdir(), leaseMs = 130000, now = Date.now }) {
  let queue = Promise.resolve();
  async function execute(req, res) {
    let directory;
    let leased;
    let leaseETag;
    let committed = false;
    try {
      if (!preflight(req)) throw new SnapshotError('Địa chỉ truy cập hoặc nguồn yêu cầu chưa được cho phép.', 403);
      const postPath = req.method === 'POST' ? new URL(req.url, 'https://pilot.invalid').pathname : null;
      const loaded = await store.read();
      if (!loaded) throw new SnapshotError('Pilot chưa được khởi tạo. Liên hệ người quản trị.');
      const state = structuredClone(loaded.state);
      const database = inspectSnapshot(state);
      const day = new Date(now()).toISOString().slice(0, 10).replaceAll('-', '');
      directory = mkdtempSync(join(temporaryRoot, 'codex-tmp-daitin-request-' + day + '-'));
      const databasePath = join(directory, 'pilot.sqlite');
      const accountsPath = join(directory, 'accounts.json');
      const logPath = join(directory, 'model-audit.jsonl');
      writeFileSync(databasePath, database, { mode: 0o600 });
      const cloudAccounts = state.accounts?.length ? state.accounts : await accounts();
      writeFileSync(accountsPath, JSON.stringify(cloudAccounts), { mode: 0o600 });
      state.accounts = cloudAccounts;
      const auth = pilotAccess(accountsPath, { secure: true, savedSessions: state.sessions });
      // These validations also bound restored counters before they reach core.
      windowLimit(12, 300000, 1024, state.loginLimits);
      const modelLimit = windowLimit(20, 86400000, 1024, state.modelLimits);
      // These POST routes take structured inputs but use the same verified
      // snapshot and app authorization as GET, without publishing state.
      const mutating = !['GET', 'HEAD'].includes(req.method) && !isReadOnlyPostPath(postPath);
      let modelReserved = false;
      if (mutating) {
        if (state.lease?.until > now()) throw new SnapshotError('Pilot đang lưu một thay đổi khác. Chờ lượt hiện tại hoàn tất rồi mở lại hồ sơ.', 409);
        if (isModelPath(postPath)) {
          const actor = auth(req);
          if (actor) {
            if (!modelLimit(actor.group + ':' + actor.name, now())) throw new SnapshotError('Tài khoản đã hết 20 lượt AI trong cửa sổ 24 giờ của pilot.', 429);
            state.modelLimits = modelLimit.snapshot();
            modelReserved = true;
          }
        }
        leased = { ...state, lease: { id: randomUUID(), until: now() + leaseMs } };
        try { leaseETag = (await store.write(leased, loaded.etag)).etag; }
        catch (error) {
          if (store.isConflict(error)) throw new SnapshotError('Hồ sơ vừa được cập nhật ở phiên khác. Mở lại trước khi lưu.', 409);
          throw error;
        }
      }
      const response = bufferedResponse();
      const nextAuth = await run({ req, res: response, state, databasePath, accountsPath, logPath, modelReserved });
      const reply = response.result();
      if (mutating) {
        const freshDatabase = readFileSync(databasePath);
        const extraAudit = (() => { try { return readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); } catch { return []; } })();
        const next = makeSnapshot(freshDatabase, { ...nextAuth, accounts: cloudAccounts, audit: [...state.audit, ...extraAudit].slice(-200) });
        if (Buffer.byteLength(JSON.stringify(next)) > maxSnapshotBytes) throw new SnapshotError('Kho pilot đã đầy. Thay đổi chưa được lưu; bản trước vẫn được giữ.', 413);
        await store.write(next, leaseETag);
        committed = true;
      }
      send(res, reply);
    } catch (error) {
      // Restore only the pre-operation DB. A model reservation remains consumed
      // even when the model or the Function fails. Never replay a model call.
      if (leased && !committed) {
        try { await store.write({ ...leased, lease: null }, leaseETag); } catch { /* expired lease permits a later recovery */ }
      }
      failure(res, error);
    } finally {
      if (directory) rmSync(directory, { recursive: true, force: true });
    }
  }
  return (req, res) => {
    const job = queue.catch(() => {}).then(() => execute(req, res));
    queue = job;
    return job;
  };
}
