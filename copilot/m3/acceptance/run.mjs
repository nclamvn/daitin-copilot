import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { hash, ids } from '../workflow.mjs';
import { matter, additional, revision, manual } from './scenario.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.DAI_TIN_PLAYWRIGHT ?? 'playwright');
const root = fileURLToPath(new URL('../../../', import.meta.url));
const work = resolve(process.argv[2]);
const receiptFile = resolve(process.argv[3]);
const port = Number(process.env.DAI_TIN_QA_PORT ?? 4315);
const origin = 'http://127.0.0.1:' + port;
mkdirSync(work, { recursive: true, mode: 0o700 });
const runDir = mkdtempSync(resolve(work, 'acceptance-'));
const directDir = resolve(runDir, 'direct');
mkdirSync(directDir, { mode: 0o700 });
const env = { ...process.env, PORT: String(port), DAI_TIN_CORPUS_MODE: 'preview',
  DAI_TIN_COPILOT: '1', DAI_TIN_M3: '1', DAI_TIN_M3_STORE: resolve(runDir, 'qa.sqlite') };
const input = { ...matter };
delete input.notice;
delete input.instructions;
for (const doc of [matter.notice, matter.instructions, additional]) writeFileSync(resolve(directDir, doc.label), doc.text);

const sleep = ms => new Promise(done => setTimeout(done, ms));
const round = start => Math.round(performance.now() - start);
let server;
let diagnostics = '';
async function start() {
  diagnostics = '';
  server = spawn(process.execPath, ['server.mjs'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stderr.on('data', data => { diagnostics += data; });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server.exitCode !== null) throw new Error('M3 start failed: ' + diagnostics);
    if ((await fetch(origin + '/api/m3/cases').catch(() => null))?.ok) return;
    await sleep(125);
  }
  throw new Error('M3 not ready: ' + diagnostics);
}
async function stop() {
  if (!server || server.exitCode !== null) return;
  server.kill();
  await once(server, 'exit');
}
async function api(path = '', data, expected = 200) {
  const result = await fetch(origin + '/api/m3/cases' + path, data === undefined ? {} :
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  assert.equal(result.status, expected, (await result.clone().text()).slice(0, 600));
  return result.json();
}
const actions = { workspace: [[], []], direct: [[], []] };
let browser;
let active;
let first;
let second;
let firstExport;
let secondExport;
const elapsed = { workspace: [], direct: [] };
const checks = [];
const mark = label => checks.push(label);
const browserErrors = [];
async function newPage() {
  browser = await chromium.launch({ executablePath: process.env.DAI_TIN_CHROME, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  page.on('pageerror', error => browserErrors.push(error.message));
  page.setDefaultTimeout(10000);
  await page.goto(origin + '/copilot/m3/');
  await page.locator('main:not([aria-busy])').waitFor();
  return page;
}
async function download(page, number, filename) {
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Tải bản ' + number }).click()]);
  assert.equal(file.suggestedFilename(), 'DT-M3-026-ban-duyet-' + number + '.md');
  await file.saveAs(resolve(runDir, filename));
  await page.locator('main:not([aria-busy])').waitFor();
  return readFileSync(resolve(runDir, filename));
}
async function waitDraft(page, number) {
  const heading = page.getByRole('heading', { name: 'Bản nháp ' + number, exact: true });
  const error = page.locator('#feedback[data-error]');
  await heading.or(error).first().waitFor({ timeout: 95000 });
  if (!(await heading.isVisible())) throw new Error(await error.textContent());
}
const step = async (arm, session, label, action) => {
  const result = await action();
  actions[arm][session].push(label);
  return result;
};
try {
  await start();
  await api('', { ...matter, reference: 'DT-M3-DECOY', title: 'HỒ SƠ KHÁC' }, 201);
  await api('', { ...matter, reference: 'DT-M3-BAD', receivedOn: '2026-05-15' }, 422);
  await api('', { ...matter, anonymized: false }, 400);
  mark('Từ chối chuyển tiếp chưa xác nhận và dữ liệu chưa được phép');
  let page = await newPage();
  let op = (label, action) => step('workspace', 0, label, action);
  let time = performance.now();
  for (const [key, label] of Object.entries({ reference: 'Mã hồ sơ', title: 'Tên nhãn hiệu',
    receivedOn: 'Ngày cơ quan tiếp nhận đơn', asOf: 'Ngày đối chiếu' })) {
    await op(label, () => page.locator('[name=' + key + ']').fill(matter[key]));
  }
  await op('Chọn tệp thông báo', () => page.locator('[data-file=notice]').setInputFiles(resolve(directDir, matter.notice.label)));
  await page.waitForFunction(() => document.querySelector('[name=notice]').value.length > 0);
  await op('Chọn tệp chỉ dẫn gốc', () => page.locator('[data-file=instructions]').setInputFiles(resolve(directDir, matter.instructions.label)));
  await page.waitForFunction(() => document.querySelector('[name=instructions]').value.length > 0);
  await op('Xác nhận dữ liệu được phép', () => page.locator('[name=anonymized]').check());
  await op('Lưu hồ sơ', () => page.getByRole('button', { name: 'Lưu hồ sơ' }).click());
  await page.getByRole('heading', { name: matter.title, exact: true }).waitFor();
  active = new URL(page.url()).searchParams.get('case');
  assert.ok(active);
  await api('', matter, 409);
  await api('/' + active + '/release/1', undefined, 404);
  mark('Mã hồ sơ trùng bị chặn, chưa duyệt thì chưa có bản xuất');
  const proof = page.getByRole('link', { name: /Điều 83.*trang 102/ });
  const href = await proof.getAttribute('href');
  assert.match(href, /#page=102$/);
  const pdf = await fetch(origin + href, { method: 'HEAD' });
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  mark('Căn cứ mở bản PDF đúng trang 102');
  await op('Giao AI soạn', () => page.getByRole('button', { name: 'Soạn bản nháp' }).click());
  await waitDraft(page, 1);
  for (const id of ids) await op('Chọn duyệt ' + id, () => page.locator('[name=approve][value=' + id + ']').check());
  await op('Duyệt ba phần', () => page.getByRole('button', { name: 'Duyệt phần đã chọn' }).click());
  firstExport = await op('Tải bản duyệt 1', () => download(page, 1, 'workspace-1.md'));
  elapsed.workspace.push(round(time));
  first = await api('/' + active);
  assert.equal(hash(firstExport), first.releases[0].sha256);
  assert.match(first.approved.response.text, /nhiệt kế điện tử dùng trong phòng thí nghiệm/iu);
  assert.doesNotMatch(first.approved.findings.text, /nhiệt kế/iu);
  await browser.close();
  await stop();

  await start();
  page = await newPage();
  op = (label, action) => step('workspace', 1, label, action);
  time = performance.now();
  await op('Mở đúng mã hồ sơ', () => page.getByRole('link', { name: /DT-M3-026/ }).click());
  await page.getByRole('heading', { name: 'Bản nháp 1', exact: true }).waitFor();
  const restored = await api('/' + active);
  assert.equal(new URL(page.url()).searchParams.get('case'), active);
  assert.deepEqual(restored, first);
  mark('Khởi động lại máy chủ và Chrome, mở đúng hồ sơ giữa hai hồ sơ');
  await op('Mở ô bổ sung nguồn', () => page.getByText('Bổ sung nguồn', { exact: true }).click());
  await op('Chọn tệp chỉ dẫn mới', () => page.locator('#matter input[type=file]').setInputFiles(resolve(directDir, additional.label)));
  await page.waitForFunction(() => document.querySelector('[name=update]').value.length > 0);
  await op('Lưu nguồn mới', () => page.getByRole('button', { name: 'Lưu nguồn mới' }).click());
  await page.getByRole('status').filter({ hasText: 'Đã lưu nguồn vào hồ sơ.' }).waitFor();
  await op('Nhập yêu cầu sửa', () => page.locator('[name=instruction]').fill(revision.instruction));
  for (const id of revision.targets) {
    await op('Chọn giao sửa ' + id, () => page.locator('[name=target][value=' + id + ']').check());
  }
  await op('Chọn sử dụng nguồn mới', () => page.locator('[name=source][value=update-1]').check());
  await op('Giao AI sửa hai phần', () => page.getByRole('button', { name: 'Tạo đề xuất sửa' }).click());
  await waitDraft(page, 2);
  const proposed = await api('/' + active);
  const current = proposed.drafts[1].sections;
  assert.match(current.response.text, /nhiệt kế hồng ngoại dùng trong phòng thí nghiệm/iu);
  assert.ok(current.response.sources.includes('update-1'));
  assert.notDeepEqual(current.attachments, first.drafts[0].sections.attachments);
  assert.deepEqual(current.findings, first.drafts[0].sections.findings);
  assert.equal(proposed.releases.length, 1);
  mark('Đề xuất sửa dùng chỉ dẫn mới, phần ngoài phạm vi giữ nguyên, chưa tự duyệt');
  assert.equal(await page.getByText('So sánh với phần đã duyệt', { exact: true }).count(), 2);
  await op('Sửa tay phần phản hồi', () => page.locator('[data-section=response] textarea').fill(current.response.text + '\n\n' + manual));
  await op('Lưu phần sửa tay', () => page.getByRole('button', { name: 'Lưu sửa tay' }).click());
  await page.getByRole('heading', { name: 'Bản nháp 3', exact: true }).waitFor();
  await api('/' + active + '/approve', { version: proposed.version, targets: ['response'] }, 409);
  mark('Yêu cầu duyệt từ phiên cũ bị chặn');
  await op('Chọn duyệt riêng phần phản hồi', () => page.locator('[name=approve][value=response]').check());
  await op('Duyệt phần phản hồi', () => page.getByRole('button', { name: 'Duyệt phần đã chọn' }).click());
  secondExport = await op('Tải bản duyệt 2', () => download(page, 2, 'workspace-2.md'));
  elapsed.workspace.push(round(time));
  second = await api('/' + active);
  const oldAgain = await download(page, 1, 'workspace-1-reopened.md');
  assert.deepEqual(oldAgain, firstExport);
  assert.equal(hash(secondExport), second.releases[1].sha256);
  assert.deepEqual(second.releases[0], first.releases[0]);
  assert.deepEqual(second.releases[1].sections.attachments, first.releases[0].sections.attachments);
  assert.deepEqual(second.releases[1].sections.findings, first.releases[0].sections.findings);
  assert.equal(second.releases[1].sections.response.draft, 3);
  assert.equal(second.releases[1].sections.attachments.draft, 1);
  assert.ok(secondExport.toString().includes(manual));
  assert.doesNotMatch(secondExport.toString(), /(?:chi-dan|xac-nhan-moi)\.txt/u);
  assert.ok(!secondExport.toString().includes(second.drafts[1].sections.attachments.text));
  mark('Xuất bản 2 đúng duyệt từng phần, bản 1 tải lại giống từng byte');
  await page.screenshot({ path: resolve(runDir, 'workspace-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: resolve(runDir, 'workspace-mobile.png'), fullPage: true });
  assert.deepEqual(browserErrors, []);
  mark('Màn hình 390px không tràn ngang, không ghi nhận lỗi JavaScript');
  await browser.close();
  browser = null;
} finally {
  await browser?.close();
  await stop();
}

const commands = promisify(execFile);
const directResults = [];
const directData = [
  { facts: input, sources: { notice: matter.notice.label, instructions: matter.instructions.label },
    approve: ids, export: 'direct-1.md', save: 'matter-DT-M3-026.json' },
  { open: 'matter-DT-M3-026.json', sources: { 'update-1': additional.label },
    targets: revision.targets, instruction: revision.instruction, append: { section: 'response', text: manual },
    approve: ['response'], export: 'direct-2.md', save: 'matter-DT-M3-026-revised.json' }
];
for (const [index, plan] of directData.entries()) {
  const time = performance.now();
  const op = (label, action) => step('direct', index, label, action);
  const planFile = resolve(directDir, 'plan-' + (index + 1) + '.json');
  await op('Chuẩn bị lệnh và quyết định trong tệp JSON', () => writeFileSync(planFile, JSON.stringify(plan, null, 2)));
  const result = await op('Chạy agent với tệp chỉ dẫn', async () => {
    const { stdout } = await commands(process.execPath,
      [fileURLToPath(new URL('./direct-agent.mjs', import.meta.url)), index ? 'revise' : 'draft', planFile, directDir],
      { env, cwd: root, timeout: 100000 });
    return JSON.parse(stdout);
  });
  directResults.push(result);
  elapsed.direct.push(round(time));
}
assert.deepEqual(directResults.map(item => item.run.inputSha256),
  second.drafts.filter(draft => draft.run).map(draft => draft.run.inputSha256));
assert.deepEqual(directResults.map(item => item.sha256), [hash(firstExport), hash(secondExport)]);
assert.match(directResults[1].modelPatch.response.text, /nhiệt kế hồng ngoại dùng trong phòng thí nghiệm/iu);
mark('Hai đầu vào gửi mô hình và hai bản xuất giống từng byte giữa hai nhánh');

const result = {
  runAt: new Date().toISOString(), case: matter.reference, synthetic: true, scenarios: 1, sessionsPerArm: 2,
  browser: 'Google Chrome / Playwright', baseline: 'Direct same-model agent with plain-file tools and operator-authored batch plans',
  method: {
    workspace: 'One scripted field fill, click, file selection or checkbox selection = one UI operation. Excludes automated assertions and re-download of old output for verification.',
    direct: 'One structured plan handoff and one process invocation per session. Plan construction scripted, includes several operator decisions. Granularity differs from UI operations.',
    elapsed: 'Milliseconds within each rehearsed task, including model, excluding browser and HTTP-server restart between sessions. CLI includes process startup and writing fixture plan. No human timing.',
    humanActiveTime: null, realLegalReview: null
  },
  checks, actions, elapsedMs: elapsed, sot: first.basis.sot, evidenceCorpus: first.basis.corpus,
  legalEvidence: first.basis.citations.map(({ id, locator, document, page, sha256, originalUrl }) =>
    ({ id, locator, document, page, sha256, originalUrl })),
  modelRuns: { workspace: second.drafts.filter(draft => draft.run).map(draft => draft.run),
    direct: directResults.map(item => item.run) },
  releases: second.releases.map(({ number, sha256, sections, sources }) => ({ number, sha256, sources,
    selectedDrafts: Object.fromEntries(Object.entries(sections).map(([id, value]) => [id, value.draft])) })),
  equivalence: { identicalModelPayloads: true, identicalExportBytes: true },
  error: null
};
writeFileSync(receiptFile, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ runDir, checks, counts: Object.fromEntries(Object.entries(actions).map(([key, rows]) =>
  [key, rows.map(row => row.length)])), elapsed, modelRuns: result.modelRuns, releases: result.releases.map(x=>x.sha256) }, null, 2));
