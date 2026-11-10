import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { matter, additional, revision, manual } from './scenario.mjs';
import { hash } from '../workflow.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const work = resolve(process.argv[2]);
mkdirSync(work, { recursive: true, mode: 0o700 });
const directory = mkdtempSync(resolve(work, 'workspace-'));
const port = Number(process.env.DAI_TIN_QA_PORT ?? 4315);
const base = 'http://127.0.0.1:' + port;
const env = { ...process.env, PORT: String(port), DAI_TIN_CORPUS_MODE: 'preview',
  DAI_TIN_COPILOT: '1', DAI_TIN_M3: '1', DAI_TIN_M3_STORE: resolve(directory, 'case.sqlite') };
const { chromium } = createRequire(import.meta.url)(process.env.DAI_TIN_PLAYWRIGHT ?? 'playwright');
const pause = ms => new Promise(done => setTimeout(done, ms));
let server;
let browser;
const errors = [];

async function api(path = '', body, status = 200) {
  const response = await fetch(base + '/api/m3/cases' + path, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  assert.equal(response.status, status, await response.clone().text());
  return response.json();
}

async function start() {
  let stderr = '';
  server = spawn(process.execPath, ['server.mjs'], { cwd: root, env, stdio: ['ignore', 'ignore', 'pipe'] });
  server.stderr.on('data', data => { stderr += data; });
  for (let i = 0; i < 80; i += 1) {
    if (server.exitCode !== null) throw new Error(stderr);
    if ((await fetch(base + '/api/m3/cases').catch(() => null))?.ok) return;
    await pause(125);
  }
  throw new Error('Workspace chưa sẵn sàng. ' + stderr);
}

async function stop() {
  if (server && server.exitCode === null && server.signalCode === null) {
    server.kill();
    await once(server, 'exit');
  }
}

async function fresh() {
  browser = await chromium.launch({ executablePath: process.env.DAI_TIN_CHROME, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(10000);
  await page.goto(base + '/copilot/m3/workspace/');
  await page.locator('#workspace:not([aria-busy])').waitFor();
  return page;
}

async function importFile(page, role, file) {
  const [picker] = await Promise.all([page.waitForEvent('filechooser'), page.locator('[data-file=' + role + ']').click()]);
  await picker.setFiles({ name: file.label, mimeType: 'text/plain', buffer: Buffer.from(file.text) });
  await page.waitForFunction(key => document.querySelector('[name=' + key + ']').value.length > 0, role);
}

async function drop(page, selector, file) {
  const handle = await page.evaluateHandle(({ label, text }) => {
    const data = new DataTransfer();
    data.items.add(new File([text], label, { type: 'text/plain' }));
    return data;
  }, file);
  await page.locator(selector).dispatchEvent('drop', { dataTransfer: handle });
  await handle.dispose();
}

async function expectDraft(page, number) {
  const caption = page.getByText(new RegExp('Bản nháp ' + number + ' ·'));
  const error = page.locator('#status[data-error]');
  await caption.or(error).first().waitFor({ timeout: 95000 });
  if (!(await caption.isVisible())) throw new Error(await error.textContent());
}

async function download(page, number, open) {
  await open();
  const [file] = await Promise.all([page.waitForEvent('download'),
    page.getByRole('button', { name: 'Tải bản duyệt ' + number }).click()]);
  assert.equal(file.suggestedFilename(), matter.reference + '-ban-duyet-' + number + '.md');
  return readFileSync(await file.path());
}

const checks = [];
try {
  await start();
  await api('', { ...matter, reference: 'DT-OTHER', title: 'Hồ sơ khác' }, 201);
  let page = await fresh();
  assert.ok(await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].some(font => font.family === 'Be Vietnam Pro' && font.status === 'loaded');
  }));
  for (const key of ['reference', 'title', 'receivedOn', 'asOf']) await page.locator('[name=' + key + ']').fill(matter[key]);
  await importFile(page, 'notice', matter.notice);
  await drop(page, '[data-intake=instructions]', matter.instructions);
  await page.waitForFunction(() => document.querySelector('[name=instructions]').value.length > 0);
  await page.locator('[name=anonymized]').check();
  await page.getByRole('button', { name: 'Lưu hồ sơ', exact: true }).click();
  await page.getByRole('heading', { name: matter.title, exact: true }).waitFor();
  const id = new URL(page.url()).searchParams.get('case');
  assert.ok(id);
  const initial = await api('/' + id);
  assert.deepEqual(initial.sources.map(row => [row.label, row.text]), [matter.notice, matter.instructions].map(row => [row.label, row.text]));
  checks.push('Tệp chọn và tệp kéo thả vào đúng hai vai trò ban đầu.');
  await page.getByRole('button', { name: 'Gửi yêu cầu' }).click();
  await expectDraft(page, 1);
  for (const key of ['findings', 'response', 'attachments']) {
    await page.locator('[data-section=' + key + ']').getByRole('button', { name: 'Duyệt phần này' }).click();
    await page.locator('#workspace:not([aria-busy])').waitFor();
  }
  const before = await api('/' + id);
  assert.match(before.releases[0].sections.response.text, /nhiệt kế điện tử/iu);
  const first = await download(page, 1, () => page.getByRole('button', { name: 'Bản duyệt 1', exact: true }).click());
  assert.equal(hash(first), before.releases[0].sha256);
  checks.push('Ô giao việc gọi Qwen thật. Ba phần đã duyệt tạo bản 1 khớp dấu kiểm.');
  await browser.close();
  browser = null;
  await stop();

  await start();
  page = await fresh();
  await page.getByRole('button', { name: new RegExp(matter.reference) }).click();
  await expectDraft(page, 1);
  assert.equal(new URL(page.url()).searchParams.get('case'), id);
  assert.deepEqual(await api('/' + id), before);
  checks.push('Chrome và máy chủ khởi động lại, mở đúng hồ sơ và dữ liệu cũ.');
  await page.getByRole('button', { name: /Điều 83 khoản 2 điểm b/ }).click();
  const href = await page.getByRole('link', { name: 'Mở PDF tại trang 102' }).getAttribute('href');
  assert.match(href, /#page=102$/);
  assert.equal((await fetch(base + href, { method: 'HEAD' })).headers.get('content-type'), 'application/pdf');
  await drop(page, '#composer', additional);
  await page.getByText(additional.label + ' · Chưa lưu', { exact: true }).waitFor();
  await page.locator('#task').fill(revision.instruction);
  await page.getByRole('button', { name: 'Gửi yêu cầu', exact: true }).click();
  const scope = page.getByRole('dialog');
  await scope.getByLabel('Nội dung phản hồi').check();
  await scope.getByLabel('Tài liệu kèm theo').check();
  await scope.getByRole('button', { name: 'Gửi yêu cầu' }).click();
  await expectDraft(page, 2);
  const proposed = await api('/' + id);
  assert.deepEqual(proposed.drafts[1].run.selectedSources, revision.sources);
  assert.match(proposed.drafts[1].sections.response.text, /nhiệt kế hồng ngoại/iu);
  assert.deepEqual(proposed.drafts[1].sections.findings, before.drafts[0].sections.findings);
  assert.equal((await api('/' + (await api()).find(row => row.reference === 'DT-OTHER').id)).sources.length, 2);
  await page.locator('[data-section=response]').getByRole('button', { name: 'Sửa tay' }).click();
  await page.getByRole('textbox', { name: 'Nội dung phản hồi' }).fill(proposed.drafts[1].sections.response.text + '\n\n' + manual);
  await page.getByRole('button', { name: 'Lưu vào bản nháp' }).click();
  await expectDraft(page, 3);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: resolve(directory, 'desktop.png') });
  await page.locator('[data-section=response]').getByRole('button', { name: 'Duyệt phần này' }).click();
  await page.getByRole('button', { name: 'Bản duyệt 2', exact: true }).waitFor();
  await api('/' + id + '/keep', { version: proposed.version, targets: ['attachments'] }, 409);
  await page.locator('[data-section=attachments]').getByRole('button', { name: 'Giữ bản cũ' }).click();
  await expectDraft(page, 4);
  const after = await api('/' + id);
  assert.equal(after.releases.length, 2);
  assert.equal(after.drafts[3].type, 'keep-approved');
  assert.deepEqual(after.drafts[1].sections, proposed.drafts[1].sections);
  assert.deepEqual(after.releases[1].sections.attachments, before.releases[0].sections.attachments);
  assert.deepEqual(after.drafts[3].sections.attachments.text, before.releases[0].sections.attachments.text);
  const second = await download(page, 2, () => page.getByRole('button', { name: 'Bản duyệt 2', exact: true }).click());
  assert.equal(hash(second), after.releases[1].sha256);
  assert.match(second.toString(), new RegExp(manual.replace('.', '\\.')));
  assert.ok(!second.toString().includes(proposed.drafts[1].sections.attachments.text));
  const old = await download(page, 1, async () => {
    await page.getByRole('button', { name: 'Phiên bản 2', exact: true }).click();
    await page.getByRole('button', { name: 'Xem bản duyệt 1' }).click();
  });
  assert.deepEqual(old, first);
  checks.push('Thêm nguồn và soạn đúng phạm vi. Duyệt một phần, giữ phần kia, tải đúng hai bản.');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.getByRole('button', { name: 'Mở hoặc đóng ngăn nguồn' }).click();
  await page.getByRole('button', { name: 'Đóng ngăn nguồn', exact: true }).click();
  await page.screenshot({ path: resolve(directory, 'mobile.png') });
  assert.deepEqual(errors, []);
  checks.push('390 px không tràn ngang, ngăn nguồn mở theo nhu cầu, không có lỗi JavaScript.');
  writeFileSync(resolve(directory, 'result.json'), JSON.stringify({
    case: matter.reference, model: after.drafts[1].run.model, checks, sha256: [hash(first), hash(second)]
  }, null, 2));
  console.log(JSON.stringify({ directory, checks, model: after.drafts[1].run.model, sha256: [hash(first), hash(second)] }, null, 2));
} finally {
  await browser?.close();
  await stop();
}
