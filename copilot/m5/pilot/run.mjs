import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes, randomInt } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import os from 'node:os';
import { hash } from '../../m3/workflow.mjs';
import { lookupBrowser, matterBrowser } from './browser.mjs';
import { questions, safety, matters } from '../acceptance/cases.mjs';

if (!process.argv[2]) throw new Error('Cần thư mục lưu pilot.');
const parent = resolve(process.argv[2]);
mkdirSync(parent, { recursive: true, mode: 0o700 });
const work = mkdtempSync(resolve(parent, 'pilot-'));
const app = fileURLToPath(new URL('../../../', import.meta.url));
const port = Number(process.env.DAI_TIN_QA_PORT ?? 4323);
const base = 'http://127.0.0.1:' + port;
const configFile = resolve(work, 'accounts.json');
const profiles = [
  { name: 'luat-su', role: 'reviewer', group: 'nhan-hieu' },
  { name: 'chuyen-vien', role: 'editor', group: 'nhan-hieu' },
  { name: 'nhom-khac', role: 'editor', group: 'khac' }
].map(item => ({ ...item, key: randomBytes(32).toString('hex') }));
writeFileSync(configFile, JSON.stringify(profiles), { mode: 0o600 });
const credentials = { username: profiles[0].name, password: profiles[0].key };
const env = { ...process.env, PORT: String(port), DAI_TIN_M5: '1', DAI_TIN_M3: '1', DAI_TIN_M4: '1',
  DAI_TIN_COPILOT: '1', DAI_TIN_PILOT: '1', DAI_TIN_CORPUS_MODE: 'preview',
  DAI_TIN_M5_ACCOUNTS: configFile, DAI_TIN_M3_STORE: resolve(work, 'pilot.sqlite') };
const selected = process.argv.includes('--smoke') ? [questions[2], safety[2], matters[0]] : [...questions, ...safety, ...matters];
const suffix = randomBytes(3).toString('hex').toUpperCase();
const fixtures = selected.map(item => ({ ...item, reference: item.id + '-' + suffix }));
const save = (name, value) => writeFileSync(resolve(work, name), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
const exec = promisify(execFile);
const manifest = [];
const key = [];
const records = [];
const blind = resolve(work, 'blind');
mkdirSync(blind, { mode: 0o700 });
const conditions = {
  schema: 'm5-pilot-simulation-2', startedAt: new Date().toISOString(),
  fixtureKind: 'previously-known synthetic acceptance set', fixtureCount: fixtures.length,
  model: process.env.DAI_TIN_MODEL_ID, modelPort: Number(process.env.DAI_TIN_MODEL_PORT),
  node: process.version, platform: os.platform(), arch: os.arch(), cpus: os.cpus()[0]?.model, memoryGB: Math.round(os.totalmem() / 1024 ** 3),
  wordLayout: 'daitin-v2', sampling: { temperature: 0, seed: 42 }, localOnly: true,
  runtimeState: 'local model already warm; serial counterbalanced execution',
  actorPolicy: 'source-based scripted edits, one repair pass', humanActiveMs: null, humanLegalScore: null,
  comparison: 'browser workspace versus file-tool comparator using same drafting model and deterministic legal tools',
  fixtureDigest: hash(JSON.stringify(fixtures)),
  codeDigest: hash(Buffer.concat(['run.mjs', 'actor.mjs', 'browser.mjs', 'direct.mjs'].map(name => readFileSync(new URL(name, import.meta.url))))),
  sourceCandidate: hash(readFileSync(resolve(app, 'sot/candidate.json'))),
  indexReceipt: hash(readFileSync(resolve(app, 'copilot/evidence.receipt.json')))
};
save('conditions.json', conditions);
save('fixtures.private.json', fixtures);
let browser;
let server;
let serverError = '';
function keep() {
  save('runs.private.json', records);
}
function blindItem(entry, arm, phase, record, dir) {
  const code = 'BL-' + randomBytes(6).toString('hex').toUpperCase();
  const type = entry.notice ? 'word' : 'answer';
  const filename = code + (type === 'word' ? '.docx' : '.json');
  let content;
  if (record.status === 'complete') {
    content = type === 'word' ? readFileSync(resolve(dir, arm + '-' + phase + '.docx')) : Buffer.from(JSON.stringify(record.answer, null, 2));
    writeFileSync(resolve(blind, filename), content, { mode: 0o600 });
  }
  manifest.push({ code, case: entry.id, phase, type, filename: content ? filename : null, sha256: content ? hash(content) : null });
  key.push({ code, arm });
}

try {
  server = spawn(process.execPath, ['server.mjs'], { cwd: app, env, stdio: ['ignore', 'ignore', 'pipe'] });
  server.stderr.on('data', bytes => { serverError += bytes; });
  let online = false;
  for (let retry = 0; retry < 80; retry += 1) {
    if (server.exitCode !== null) throw new Error(serverError);
    if ((await fetch(base + '/api/m5/status').catch(() => null))?.status === 401) { online = true; break; }
    await new Promise(done => setTimeout(done, 100));
  }
  assert.ok(online, 'Pilot không khởi động được.');
  const { chromium } = createRequire(import.meta.url)(process.env.DAI_TIN_PLAYWRIGHT ?? 'playwright');
  browser = await chromium.launch({ executablePath: process.env.DAI_TIN_CHROME, headless: true });
  for (const [index, entry] of fixtures.entries()) {
    const dir = resolve(work, entry.id);
    mkdirSync(dir, { mode: 0o700 });
    const input = resolve(dir, 'input.json');
    writeFileSync(input, JSON.stringify(entry), { mode: 0o600 });
    const row = { id: entry.id, workspace: {}, direct: {}, order: [] };
    records.push(row);
    const phases = entry.notice ? [1, 2] : [0];
    for (const phase of phases) {
      const order = (index + phase) % 2 ? ['workspace', 'direct'] : ['direct', 'workspace'];
      row.order.push({ phase, arms: order });
      for (const arm of order) {
        const outerStart = performance.now();
        if (phase === 2 && row[arm][1]?.status !== 'complete') {
          row[arm][phase] = { status: 'blocked', error: 'Phiên 1 chưa hoàn tất.', actions: [], humanActiveMs: null };
        } else if (arm === 'workspace') {
          row[arm][phase] = entry.notice
            ? await matterBrowser(browser, entry, phase, row[arm][1], { base, credentials, dir, screenshot: entry.id === 'W01' })
            : await lookupBrowser(browser, entry, { base, credentials, dir });
        } else {
          try {
            const result = await exec(process.execPath, [fileURLToPath(new URL('direct.mjs', import.meta.url)), phase === 0 ? 'lookup' : String(phase), input, dir],
              { env, timeout: 110000, maxBuffer: 1024 * 1024 });
            row[arm][phase] = JSON.parse(result.stdout);
          } catch (error) {
            const file = resolve(dir, 'direct-' + (phase === 0 ? 'lookup' : phase) + '.json');
            try { row[arm][phase] = JSON.parse(readFileSync(file)); }
            catch { row[arm][phase] = { status: 'blocked', error: error.message, actions: [], humanActiveMs: null }; }
          }
        }
        const record = row[arm][phase];
        record.outerWallMs = Math.round(performance.now() - outerStart);
        if (arm === 'workspace') writeFileSync(resolve(dir, 'workspace-' + phase + '.json'), JSON.stringify(record, null, 2), { mode: 0o600 });
        keep();
      }
      const blindOrder = randomInt(2) ? ['workspace', 'direct'] : ['direct', 'workspace'];
      for (const arm of blindOrder) blindItem(entry, arm, phase, row[arm][phase], dir);
    }
    console.log(entry.id + ' · ' + ['workspace', 'direct'].map(arm => arm + ' ' + phases.map(phase => row[arm][phase].status).join('/')).join(' · '));
  }
  save('manifest.json', manifest);
  save('arm-key.private.json', key);
  save('sealed.json', { createdAt: new Date().toISOString(), manifestDigest: hash(JSON.stringify(manifest)),
    fixtureDigest: conditions.fixtureDigest, runDigest: hash(readFileSync(resolve(work, 'runs.private.json'))), artifactCount: manifest.length });
} finally {
  await browser?.close();
  if (server && server.exitCode === null && !server.signalCode) { server.kill(); await once(server, 'exit'); }
  writeFileSync(resolve(work, 'server.log'), serverError, { mode: 0o600 });
}
console.log(work);
if (records.some(row => Object.values(row.workspace).some(item => item.status !== 'complete') ||
    Object.values(row.direct).some(item => item.status !== 'complete'))) process.exitCode = 1;
