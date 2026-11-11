import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { hash, ids } from '../../m3/workflow.mjs';
import { brandedWordLayout } from '../word-brand.mjs';
import { simulatedReview } from './simulated-review.mjs';
import { openWorkspaceBrowser, useWorkspace } from './workspace-browser.mjs';

const fixtures = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
mkdirSync(output, { recursive: true, mode: 0o700 });
const work = mkdtempSync(resolve(output, 'paired-'));
const root = fileURLToPath(new URL('../../../', import.meta.url));
const blindDir = resolve(work, 'blind');
mkdirSync(blindDir, { mode: 0o700 });
const port = Number(process.env.DAI_TIN_QA_PORT ?? 4318);
const realUI = process.argv.includes('--browser');
const base = 'http://127.0.0.1:' + port;
const env = { ...process.env, PORT: String(port), DAI_TIN_CORPUS_MODE: 'preview', DAI_TIN_COPILOT: '1',
  DAI_TIN_M3: '1', DAI_TIN_M4: '1', DAI_TIN_M3_STORE: resolve(work, 'rehearsal.sqlite') };
const oracles = JSON.parse(readFileSync(resolve(fixtures, 'oracle.json'), 'utf8'));
assert.equal(oracles.length, 8);
const cases = oracles.map((oracle, index) => ({
  oracle, id: oracle.case.reference, order: index % 2 ? ['direct', 'workspace'] : ['workspace', 'direct'],
  work: resolve(work, oracle.case.reference), workspace: {}, direct: {}
}));
const instruction = 'Cập nhật phần phản hồi theo cụm hàng hóa mới khách hàng xác nhận. Đề xuất thêm bản sao thông báo ở phần tài liệu kèm theo và ghi rõ dự kiến.';
const command = promisify(execFile);
const direct = fileURLToPath(new URL('../acceptance/direct.mjs', import.meta.url));
const json = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
const getFile = (entry, name) => resolve(fixtures, entry.id, name);
const selected = entry => ['application', 'noticeNumber', 'noticeDate', 'deadline'].reduce((map, key) =>
  ({ ...map, [key]: entry.oracle[key] }), {});
const pdf = entry => ({
  label: 'thong-bao.pdf', anchors: [{ page: entry.oracle.anchorPage, text: entry.oracle.anchorText,
    mode: entry.oracle.scanPages.includes(entry.oracle.anchorPage) ? 'manual' : 'text' }], fields: selected(entry)
});
const doc = (entry, name) => ({ label: name, text: readFileSync(getFile(entry, name), 'utf8') });
const outName = (arm, phase) => arm + '-' + phase + '.docx';
let server;
let browser;

async function start() {
  let stderr = '';
  server = spawn(process.execPath, ['server.mjs'], { cwd: root, env, stdio: ['ignore', 'ignore', 'pipe'] });
  server.stderr.on('data', data => { stderr += data; });
  for (let i = 0; i < 80; i += 1) {
    if (server.exitCode !== null) throw new Error(stderr);
    if ((await fetch(base + '/api/m4/status').catch(() => null))?.ok) return;
    await new Promise(done => setTimeout(done, 100));
  }
  throw new Error('Pilot API unavailable ' + stderr);
}

async function stop() {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  server.kill();
  await once(server, 'exit');
}

async function request(path, data, format = 'json') {
  const res = await fetch(base + path, data === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error(await res.text());
  if (format === 'json') return res.json();
  const bytes = Buffer.from(await res.arrayBuffer());
  assert.equal(res.headers.get('x-artifact-sha256'), hash(bytes));
  assert.ok(bytes.includes(Buffer.from('word/media/daitin-gray.png')));
  return bytes;
}

async function workspace(entry, phase, record) {
  let matter;
  if (phase === 1) {
    const content = readFileSync(getFile(entry, 'thong-bao.pdf')).toString('base64');
    const inspection = await request('/api/m4/pdf', { content, anonymized: true });
    matter = await request('/api/m4/cases', { ...entry.oracle.case, content, anonymized: true,
      instructions: doc(entry, 'chi-dan.txt'), pdf: { ...pdf(entry), sha256: inspection.sha256, verified: true } });
    entry.workspace.matter = matter.id;
  } else {
    const stored = await request('/api/m3/cases/' + entry.workspace.matter);
    assert.equal(stored.reference, entry.id);
    assert.equal(stored.releases[0].sha256, entry.workspace[1].markdownHash);
    matter = await request('/api/m3/cases/' + stored.id + '/source', { ...doc(entry, 'xac-nhan-moi.txt'), version: stored.version });
  }
  const path = '/api/m3/cases/' + matter.id;
  const draft = await request(path + '/propose', { version: matter.version, sources: matter.sources.map(item => item.id),
    targets: phase === 1 ? ids : ['response', 'attachments'], ...(phase === 2 ? { instruction } : {}) });
  record.run = draft.drafts.at(-1).run;
  record.draft = draft.drafts.at(-1).sections;
  json(resolve(entry.work, 'workspace-draft-' + phase + '.json'), record.draft);
  const approved = await request(path + '/approve', { version: draft.version, targets: phase === 1 ? ids : ['response'] });
  const release = approved.releases.at(-1);
  assert.equal(release.number, phase);
  if (phase === 2) {
    assert.deepEqual(release.sections.attachments, approved.releases[0].sections.attachments);
    const old = await request('/api/m4/cases/' + matter.id + '/word/1/' + brandedWordLayout, undefined, 'word');
    assert.equal(hash(old), entry.workspace[1].sha);
  }
  const bytes = await request('/api/m4/cases/' + matter.id + '/word/' + phase + '/' + brandedWordLayout, undefined, 'word');
  writeFileSync(resolve(entry.work, outName('workspace', phase)), bytes, { mode: 0o600 });
  record.sha = hash(bytes);
  record.markdownHash = release.sha256;
}

async function agent(entry, phase, record) {
  record.actions = [];
  const action = async (name, fn) => {
    const start = performance.now();
    try { return await fn(); }
    finally { record.actions.push({ name, ms: Math.round(performance.now() - start) }); }
  };
  const plan = phase === 1 ? {
    snapshot: 'direct-state.json', case: entry.oracle.case, pdf: pdf(entry),
    pdfFile: getFile(entry, 'thong-bao.pdf'), instructionsFile: getFile(entry, 'chi-dan.txt'), reviewOnly: true
  } : {
    snapshot: 'direct-state.json', updateFile: getFile(entry, 'xac-nhan-moi.txt'),
    instruction, targets: ['response', 'attachments'], reviewOnly: true
  };
  const draftPlan = resolve(entry.work, 'direct-plan-' + phase + '.json');
  await action('Ghi kế hoạch giao việc theo phiên', () => json(draftPlan, plan));
  const result = await action('Gọi agent để nhận bản nháp', () =>
    command(process.execPath, [direct, phase === 1 ? 'draft' : 'revise', draftPlan, entry.work],
      { cwd: root, env, timeout: 100000 }));
  const proposed = await action('Đọc bản nháp', () => JSON.parse(result.stdout));
  record.run = proposed.run;
  record.draft = proposed.sections;
  json(resolve(entry.work, 'direct-draft-' + phase + '.json'), record.draft);
  const approvePlan = resolve(entry.work, 'direct-approve-' + phase + '.json');
  const { issues, edits } = simulatedReview(entry.oracle, proposed.sections, phase);
  record.issues = issues;
  await action('Ghi quyết định duyệt' + (realUI && Object.keys(edits).length ? ' và phần sửa' : ''), () =>
    json(approvePlan, { snapshot: plan.snapshot, output: outName('direct', phase), approve: phase === 1 ? ids : ['response'],
      ...(realUI && Object.keys(edits).length ? { edits } : {}) }));
  const { stdout } = await action('Duyệt và xuất Word bằng công cụ tệp', () =>
    command(process.execPath, [direct, 'approve', approvePlan, entry.work], { cwd: root, env, timeout: 100000 }));
  const resultWord = JSON.parse(stdout);
  assert.equal(resultWord.number, phase);
  const bytes = readFileSync(resolve(entry.work, outName('direct', phase)));
  assert.ok(bytes.includes(Buffer.from('word/media/daitin-gray.png')));
  assert.equal(hash(bytes), resultWord.sha256);
  record.sha = resultWord.sha256;
}

for (const entry of cases) mkdirSync(entry.work, { mode: 0o700 });
try {
  for (const phase of [1, 2]) {
    await start();
    if (realUI) browser = await openWorkspaceBrowser();
    for (const entry of cases) {
      for (const arm of entry.order) {
        const record = { status: 'blocked' };
        entry[arm][phase] = record;
        if (phase === 2 && entry[arm][1].status !== 'complete') {
          record.error = 'Phiên 1 chưa có Word được duyệt.';
          continue;
        }
        const start = performance.now();
        try {
          if (realUI && arm === 'workspace') await useWorkspace(browser, entry, phase, record, { base, getFile, request, instruction });
          else await (arm === 'workspace' ? workspace : agent)(entry, phase, record);
          record.status = 'complete';
        } catch (error) {
          record.error = String(error.stderr?.trim().split('\n').find(line => line.startsWith('Error:')) ?? error.message).slice(0, 320);
        } finally {
          record.wallMs = Math.round(performance.now() - start);
        }
      }
      console.log(entry.id + ' phiên ' + phase + ' · ' + entry.order.map(arm => arm + ' ' + entry[arm][phase].status).join(' / '));
    }
    await browser?.close();
    browser = undefined;
    await stop();
  }
} finally {
  await browser?.close();
  await stop();
}

const mapping = [];
for (const entry of cases) for (const arm of entry.order) for (const phase of [1, 2]) {
  const record = entry[arm][phase];
  const code = 'BL-' + randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
  const filename = record.status === 'complete' ? code + '.docx' : null;
  if (filename) writeFileSync(resolve(blindDir, filename), readFileSync(resolve(entry.work, outName(arm, phase))), { mode: 0o600 });
  mapping.push({ code, case: entry.id, phase, arm, filename, sha: record.sha ?? null });
}
const blind = mapping.map(({ code, case: id, phase, filename }) => ({ code, case: id, phase, filename })).sort((a, b) => a.code.localeCompare(b.code));
json(resolve(blindDir, 'index.json'), blind);
json(resolve(work, 'blind-key.private.json'), mapping);
json(resolve(work, 'runs.json'), cases.map(({ id, order, workspace, direct }) => ({ id, order, workspace, direct })));
console.log('Bằng chứng kỹ thuật: ' + work);
