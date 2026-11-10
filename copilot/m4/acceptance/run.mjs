import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { hash, ids } from '../../m3/workflow.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const fixtures = resolve(process.argv[2]);
const work = mkdtempSync(resolve(process.argv[3], 'qa-'));
const port = Number(process.env.DAI_TIN_QA_PORT ?? 4316);
const base = 'http://127.0.0.1:' + port;
const env = { ...process.env, PORT: String(port), DAI_TIN_CORPUS_MODE: 'preview',
  DAI_TIN_COPILOT: '1', DAI_TIN_M3: '1', DAI_TIN_M4: '1', DAI_TIN_M3_STORE: resolve(work, 'case.sqlite') };
const { chromium } = createRequire(import.meta.url)(process.env.DAI_TIN_PLAYWRIGHT ?? 'playwright');
const oracles = JSON.parse(readFileSync(resolve(fixtures, 'oracle.json')));
const instruction = 'Cập nhật phần phản hồi theo cụm hàng hóa mới khách hàng xác nhận. Đề xuất thêm bản sao thông báo ở phần tài liệu kèm theo và ghi rõ dự kiến.';
const manual = 'Đề nghị ghi nhận nội dung làm rõ nêu trên.';
const checks = [];
let server;
let browser;
const browserErrors = [];

async function get(path, data, status = 200) {
  const res = await fetch(base + path, data === undefined ? undefined : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
  });
  if (res.status !== status) assert.fail(path + ' ' + res.status + ' ' + (await res.text()).slice(0, 300));
  return res;
}
const json = async (...args) => (await get(...args)).json();

async function start() {
  let stderr = '';
  server = spawn(process.execPath, ['server.mjs'], { cwd: root, env, stdio: ['ignore', 'ignore', 'pipe'] });
  server.stderr.on('data', data => { stderr += data; });
  for (let i = 0; i < 80; i += 1) {
    if (server.exitCode !== null) throw new Error(stderr);
    if ((await fetch(base + '/api/m4/status').catch(() => null))?.ok) return;
    await new Promise(done => setTimeout(done, 100));
  }
  throw new Error('Server unavailable ' + stderr);
}

async function stop() {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  server.kill();
  await once(server, 'exit');
}

async function page() {
  browser = await chromium.launch({ executablePath: process.env.DAI_TIN_CHROME, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 940 }, acceptDownloads: true });
  const tab = await context.newPage();
  tab.on('pageerror', error => browserErrors.push(error.message));
  tab.setDefaultTimeout(10000);
  await tab.goto(base + '/copilot/m3/workspace/');
  await tab.locator('#workspace:not([aria-busy])').waitFor();
  return tab;
}

async function waitDraft(tab, version) {
  const expected = tab.getByText(new RegExp('Bản nháp ' + version + ' ·'));
  const error = tab.locator('#status[data-error]');
  await expected.or(error).first().waitFor({ timeout: 95000 });
  if (!(await expected.isVisible())) throw new Error(await error.innerText());
}

async function drop(tab, selector, filename, text) {
  const data = await tab.evaluateHandle(({ filename, text }) => {
    const data = new DataTransfer();
    data.items.add(new File([text], filename, { type: 'text/plain' }));
    return data;
  }, { filename, text });
  await tab.locator(selector).dispatchEvent('drop', { dataTransfer: data });
  await data.dispose();
}

async function loadWord(tab, number, open) {
  await open();
  const [file] = await Promise.all([tab.waitForEvent('download'),
    tab.getByRole('button', { name: 'Tải Word bản ' + number }).click()]);
  const bytes = readFileSync(await file.path());
  assert.equal(file.suggestedFilename(), 'M4-01-ban-duyet-' + number + '.docx');
  writeFileSync(resolve(work, 'copilot-' + number + '.docx'), bytes);
  return hash(bytes);
}

const getFile = (oracle, name) => resolve(fixtures, oracle.case.reference, name);
function controls(oracle, inspection, anchors) {
  const values = Object.fromEntries(['application', 'noticeNumber', 'noticeDate', 'deadline'].map(key => [key, oracle[key]]));
  return { label: 'thong-bao.pdf', verified: true, sha256: inspection.sha256, anchors, fields: values };
}

const workspaceMs = [];
const baselineMs = [];
let initial;
let final;
let firstHash;
let secondHash;
try {
  await start();
  for (const oracle of oracles) {
    const bytes = readFileSync(getFile(oracle, 'thong-bao.pdf'));
    const content = bytes.toString('base64');
    const data = await json('/api/m4/pdf', { content, anonymized: true });
    assert.equal(data.sha256, hash(bytes));
    assert.equal(data.pages.length, oracle.pages);
    assert.deepEqual(data.pages.filter(item => !item.text).map(item => item.page), oracle.scanPages);
    if (oracle.kind === 'conflict') assert.equal(new Set(data.fields.application.map(item => item.value)).size, 2);
    if (oracle.kind === 'missing-received') assert.deepEqual(data.fields.receivedOn, []);
    if (oracle.kind === 'relative-date') assert.deepEqual(data.fields.deadline, []);
    if (oracle.case.reference !== 'M4-01') {
      const mode = oracle.scanPages.includes(oracle.anchorPage) ? 'manual' : 'text';
      const args = { ...oracle.case, content, anonymized: true, instructions: {
        label: 'chi-dan.txt', text: readFileSync(getFile(oracle, 'chi-dan.txt'), 'utf8')
      }, pdf: controls(oracle, data, [{ page: oracle.anchorPage, text: oracle.anchorText, mode }]) };
      if (oracle.kind === 'transition') await json('/api/m4/cases', { ...args, pendingAtCutover: null }, 422);
      if (oracle.kind === 'conflict') await json('/api/m4/cases', { ...args,
        pdf: { ...args.pdf, fields: { ...args.pdf.fields, application: null } } }, 422);
      if (oracle.kind === 'multipage') await json('/api/m4/cases', { ...args,
        pdf: { ...args.pdf, anchors: [{ page: 1, text: oracle.anchorText, mode: 'text' }] } }, 422);
      const saved = await json('/api/m4/cases', args, 201);
      assert.equal(saved.document.anchors[0].mode, mode);
      assert.equal(saved.document.fields.application.value, oracle.application);
      assert.equal(saved.document.fields.deadline.value, oracle.deadline);
      const savedBytes = Buffer.from(await (await get('/api/m4/cases/' + saved.id + '/notice.pdf')).arrayBuffer());
      assert.deepEqual(savedBytes, bytes);
    }
    checks.push(oracle.case.reference + ' · ' + oracle.kind + ' · đạt kiểm tra kỹ thuật đầu vào');
  }
  await json('/api/m4/pdf', { content: 'SGVsbG8=', anonymized: true }, 400);
  await json('/api/m4/pdf', { content: 'SGVsbG8=', anonymized: false }, 400);
  checks.push('Chặn PDF giả và yêu cầu thiếu xác nhận quyền sử dụng');

  const oracle = oracles[0];
  let tab = await page();
  let startAt = performance.now();
  await tab.locator('[name=reference]').fill(oracle.case.reference);
  await tab.locator('[name=asOf]').fill(oracle.case.asOf);
  await tab.locator('[name=anonymized]').check();
  const [picker] = await Promise.all([tab.waitForEvent('filechooser'), tab.locator('[data-file=notice]').click()]);
  await picker.setFiles(getFile(oracle, 'thong-bao.pdf'));
  await tab.getByRole('img', { name: /Ảnh trang 1/ }).waitFor();
  await tab.waitForFunction(() => document.querySelector('.pdf-page-view img')?.naturalWidth > 0);
  for (const value of [oracle.case.title, oracle.case.receivedOn, oracle.application, oracle.noticeNumber, oracle.noticeDate, oracle.deadline]) {
    await tab.getByRole('button', { name: value + ' · Trang 1', exact: true }).click();
  }
  const layer = tab.getByRole('textbox', { name: 'Văn bản trang PDF' });
  await layer.evaluate((field, phrase) => {
    const start = field.value.indexOf(phrase);
    if (start < 0) throw new Error('Thiếu đoạn nguồn');
    field.focus();
    field.setSelectionRange(start, start + phrase.length);
  }, oracle.anchorText);
  await tab.getByRole('button', { name: 'Dùng đoạn đã bôi chọn' }).click();
  await drop(tab, '[data-intake=instructions]', 'chi-dan.txt', readFileSync(getFile(oracle, 'chi-dan.txt'), 'utf8'));
  await tab.waitForFunction(() => document.querySelector('[name=instructions]').value.length > 0);
  await tab.locator('#pdf-confirm').check();
  await tab.locator('#pdf-intake').scrollIntoViewIfNeeded();
  await tab.screenshot({ path: resolve(work, 'pdf-ui.png') });
  await tab.getByRole('button', { name: 'Lưu hồ sơ', exact: true }).click();
  await tab.getByRole('heading', { name: oracle.case.title, exact: true }).waitFor();
  const id = new URL(tab.url()).searchParams.get('case');
  await get('/api/m4/cases/' + id + '/word/1', undefined, 404);
  await tab.getByRole('button', { name: 'Gửi yêu cầu', exact: true }).click();
  await waitDraft(tab, 1);
  for (const key of ids) {
    await tab.locator('[data-section=' + key + ']').getByRole('button', { name: 'Duyệt phần này' }).click();
    await tab.locator('#workspace:not([aria-busy])').waitFor();
  }
  initial = await json('/api/m3/cases/' + id);
  assert.match(initial.releases[0].sections.response.text.toLowerCase(), new RegExp(oracle.old));
  assert.doesNotMatch(initial.releases[0].sections.findings.text, /M4-01|thông báo số/iu);
  assert.equal(initial.document.anchors[0].text, oracle.anchorText);
  assert.equal(initial.document.fields.receivedOn.page, 1);
  firstHash = await loadWord(tab, 1, () => tab.getByRole('button', { name: 'Bản duyệt 1', exact: true }).click());
  workspaceMs.push(Math.round(performance.now() - startAt));
  await browser.close();
  browser = null;
  await stop();

  await start();
  tab = await page();
  startAt = performance.now();
  await tab.getByRole('button', { name: /M4-01/ }).click();
  assert.deepEqual(await json('/api/m3/cases/' + id), initial);
  await tab.locator('#sources-pane').getByRole('button', { name: /thong-bao\.pdf/ }).click();
  const pdfLink = tab.getByRole('link', { name: 'Trang 1 · Đoạn trích' });
  assert.match(await pdfLink.getAttribute('href'), /notice\.pdf#page=1$/);
  const sourceRes = await get('/api/m4/cases/' + id + '/notice.pdf');
  assert.equal(sourceRes.headers.get('x-artifact-sha256'), initial.document.sha256);
  await drop(tab, '#composer', 'xac-nhan-moi.txt', readFileSync(getFile(oracle, 'xac-nhan-moi.txt'), 'utf8'));
  await tab.getByText('xac-nhan-moi.txt · Chưa lưu', { exact: true }).waitFor();
  await tab.locator('#task').fill(instruction);
  await tab.getByRole('button', { name: 'Gửi yêu cầu', exact: true }).click();
  const scope = tab.getByRole('dialog');
  await scope.getByLabel('Nội dung phản hồi').check();
  await scope.getByLabel('Tài liệu kèm theo').check();
  await scope.getByRole('button', { name: 'Gửi yêu cầu' }).click();
  await waitDraft(tab, 2);
  const proposed = await json('/api/m3/cases/' + id);
  assert.match(proposed.drafts[1].sections.response.text.toLowerCase(), new RegExp(oracle.new));
  assert.doesNotMatch(proposed.drafts[1].sections.response.text, /được trình bày trực tiếp|chỉ dẫn mới nhất|M4-01/iu);
  await tab.locator('[data-section=response]').getByRole('button', { name: 'Sửa tay' }).click();
  await tab.getByRole('textbox', { name: 'Nội dung phản hồi' }).fill(proposed.drafts[1].sections.response.text + '\n\n' + manual);
  await tab.getByRole('button', { name: 'Lưu vào bản nháp' }).click();
  await waitDraft(tab, 3);
  await tab.locator('[data-section=response]').getByRole('button', { name: 'Duyệt phần này' }).click();
  await tab.getByRole('button', { name: 'Bản duyệt 2', exact: true }).waitFor();
  secondHash = await loadWord(tab, 2, () => tab.getByRole('button', { name: 'Bản duyệt 2', exact: true }).click());
  workspaceMs.push(Math.round(performance.now() - startAt));
  final = await json('/api/m3/cases/' + id);
  assert.deepEqual(final.releases[1].sections.attachments, initial.releases[0].sections.attachments);
  assert.equal(final.releases[1].sections.response.draft, 3);
  assert.equal(hash(Buffer.from(await (await get('/api/m4/cases/' + id + '/word/1')).arrayBuffer())), firstHash);
  await tab.setViewportSize({ width: 390, height: 844 });
  assert.equal(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await tab.getByRole('button', { name: 'Mở danh sách hồ sơ' }).click();
  await tab.getByRole('button', { name: 'Hồ sơ mới', exact: true }).click();
  await tab.locator('[name=anonymized]').check();
  const [scanPicker] = await Promise.all([tab.waitForEvent('filechooser'), tab.locator('[data-file=notice]').click()]);
  await scanPicker.setFiles(getFile(oracles[4], 'thong-bao.pdf'));
  await tab.getByText('Trang này chưa có lớp văn bản. Đọc ảnh trang và nhập đoạn bằng tay.').waitFor();
  await tab.waitForFunction(() => document.querySelector('.pdf-page-view img')?.naturalWidth > 0);
  await tab.getByText('Nhập đoạn bằng tay theo trang này', { exact: true }).click();
  await tab.getByRole('textbox', { name: 'Đoạn nhập tay theo trang' }).fill(oracles[4].anchorText);
  await tab.getByRole('button', { name: 'Lưu đoạn nhập tay' }).click();
  assert.ok(await tab.getByText('Trang 1 · Nhập tay', { exact: false }).isVisible());
  assert.deepEqual(browserErrors, []);
  checks.push('Chrome + Qwen qua hai phiên, duyệt đúng một phần, tải lại Word 1 giống từng byte. Thử thao tác nhập tay cho bản scan trên 390 px.');
} finally {
  await browser?.close();
  await stop();
}

const direct = [];
const run = promisify(execFile);
const oracle = oracles[0];
const plans = [
  { snapshot: 'direct.json', output: 'direct-1.docx', case: oracle.case, approve: ids,
    pdfFile: getFile(oracle, 'thong-bao.pdf'), instructionsFile: getFile(oracle, 'chi-dan.txt'),
    pdf: { label: 'thong-bao.pdf', anchors: [{ page: 1, text: oracle.anchorText, mode: 'text' }],
      fields: Object.fromEntries(['application', 'noticeNumber', 'noticeDate', 'deadline'].map(key => [key, oracle[key]])) } },
  { snapshot: 'direct.json', output: 'direct-2.docx', updateFile: getFile(oracle, 'xac-nhan-moi.txt'),
    instruction, targets: ['response', 'attachments'], approve: ['response'], append: { section: 'response', text: manual } }
];
for (const [index, plan] of plans.entries()) {
  const start = performance.now();
  const planFile = resolve(work, 'plan-' + index + '.json');
  writeFileSync(planFile, JSON.stringify(plan));
  const { stdout } = await run(process.execPath, [fileURLToPath(new URL('./direct.mjs', import.meta.url)),
    index ? 'revise' : 'draft', planFile, work], { cwd: root, env, timeout: 100000 });
  direct.push(JSON.parse(stdout));
  baselineMs.push(Math.round(performance.now() - start));
}
assert.deepEqual(direct.map(item => item.run.inputSha256), final.drafts.filter(item => item.run).map(item => item.run.inputSha256));
assert.deepEqual(direct.map(item => item.sha256), [firstHash, secondHash]);
checks.push('Agent trực tiếp dùng cùng Poppler, SOT, Qwen và bộ dựng Word. Đầu vào model và hai Word giống từng byte.');
const evidence = {
  at: new Date().toISOString(), fixtures: oracles.length, endToEndPairedCases: 1, synthetic: true, humanReview: null,
  model: direct[0].run.model, checks, hashes: [firstHash, secondHash],
  rehearsalMs: { workspace: workspaceMs, direct: baselineMs }, modelPayloads: direct.map(item => item.run.inputSha256),
  note: 'Thời gian máy chạy kịch bản. Nhánh trình duyệt và CLI gộp thao tác khác nhau. Chưa đo người dùng.',
  releases: final.releases.map(release => ({ number: release.number, sections: release.sections }))
};
writeFileSync(resolve(work, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({ work, ...evidence, releases: undefined }, null, 2));
