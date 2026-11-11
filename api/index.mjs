import { createBlobStore } from '../web/blob-store.mjs';
import { createSnapshotRuntime } from '../web/snapshot-runtime.mjs';
import { allowedRequest, webSettings } from '../web/security.mjs';

Object.assign(process.env, {
  DAI_TIN_WEB: '1', DAI_TIN_M5: '1', DAI_TIN_M4: '1', DAI_TIN_M3: '1',
  DAI_TIN_COPILOT: '1', DAI_TIN_PILOT: '1', DAI_TIN_CORPUS_MODE: 'preview',
  DAI_TIN_PDF_ENGINE: 'pdfjs', DAI_TIN_MAX_PDF_BYTES: String(2 * 1024 * 1024),
  DAI_TIN_MODEL_MODE: process.env.DAI_TIN_MODEL_MODE ?? 'disabled'
});
let immutableCopilot;
const handler = createSnapshotRuntime({
  store: createBlobStore(),
  preflight: req => allowedRequest(req, webSettings()),
  accounts: () => {
    if (!process.env.DAI_TIN_M5_ACCOUNTS_JSON) throw new Error('Cloud pilot accounts are not configured');
    return JSON.parse(process.env.DAI_TIN_M5_ACCOUNTS_JSON);
  },
  async run({ req, res, state, databasePath, accountsPath, logPath, modelReserved }) {
    process.env.DAI_TIN_M3_STORE = databasePath;
    process.env.DAI_TIN_M5_ACCOUNTS = accountsPath;
    process.env.DAI_TIN_MODEL_LOG = logPath;
    const [{ createApp }, research, { createCopilot }] = await Promise.all([
      import('../server.mjs'), import('../research.mjs'), import('../copilot/service.mjs')
    ]);
    // Immutable evidence files are verified once per isolate, not copied into /tmp.
    immutableCopilot ??= createCopilot(research.getCatalog(), research.resolveProcedure);
    const app = createApp({ state, modelReserved, immutableCopilot });
    try {
      await app.handle(req, res);
      return app.state();
    } finally { app.close(); }
  }
});

export default handler;
