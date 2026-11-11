import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { hash } from '../../m3/workflow.mjs';
import { matters } from './cases.mjs';

const dir = resolve(process.argv[2]);
mkdirSync(dir, { recursive: true, mode: 0o700 });
const { chromium } = createRequire(import.meta.url)(process.env.DAI_TIN_PLAYWRIGHT ?? 'playwright');
const account = JSON.parse(readFileSync(process.env.DAI_TIN_M5_ACCOUNTS)).find(item => item.name === 'luat-su');
const base = process.env.DAI_TIN_M5_BASE ?? 'http://127.0.0.1:4320';
const workspace = base + '/copilot/m3/workspace/';
const credentials = { username: account.name, password: account.key };
const entry = matters[1];
const reference = 'UI-' + randomBytes(3).toString('hex').toUpperCase();
const browser = await chromium.launch({ executablePath: process.env.DAI_TIN_CHROME, headless: true });
const errors = [];
let id;
let firstHash;

async function page(viewport) {
  const context = await browser.newContext({ viewport, httpCredentials: credentials, acceptDownloads: true });
  const tab = await context.newPage();
  tab.on('pageerror', error => errors.push(error.message));
  tab.setDefaultTimeout(9000);
  return { context, tab };
}
const btn = (tab, name) => tab.getByRole('button', { name, exact: true });
const ready = tab => tab.locator('#workspace:not([aria-busy])').waitFor();
async function click(tab, name) {
  await ready(tab);
  await btn(tab, name).click();
}
async function generate(tab, text, num) {
  await tab.locator('#task').fill(text);
  await btn(tab, 'Gửi yêu cầu').click();
  await tab.getByText('Bản nháp ' + num + ' ·', { exact: false }).waitFor({ timeout: 95000 });
  await ready(tab);
}
async function download(tab, n) {
  await click(tab, 'Bản duyệt ' + n);
  const [file] = await Promise.all([tab.waitForEvent('download'), click(tab, 'Tải Word bản ' + n)]);
  assert.match(file.suggestedFilename(), new RegExp('ban-duyet-' + n + '-daitin\\.docx$'));
  const path = resolve(dir, 'ban-' + n + '.docx');
  await file.saveAs(path);
  await ready(tab);
  const bytes = readFileSync(path);
  assert.ok(bytes.includes(Buffer.from('word/media/daitin-gray.png')));
  return hash(bytes);
}

try {
  const first = await page({ width: 1440, height: 960 });
  const tab = first.tab;
  await tab.goto(workspace);
  await ready(tab);
  await tab.locator('#research-paper').waitFor();
  await tab.locator('#task').fill('Gia hạn nhãn hiệu dùng mẫu nào nếu dự kiến nộp ngày 01/07/2026?');
  await tab.locator('#ask-anonymized').check();
  await click(tab, 'Gửi yêu cầu');
  await tab.getByRole('heading', { name: /Mẫu số 01 tại Phụ lục/ }).waitFor();
  await ready(tab);
  const form = tab.getByRole('link', { name: 'Mở đúng phiên bản biểu mẫu' });
  assert.match(await form.getAttribute('href'), /\/tt20-pl\/[a-f0-9]{64}\.pdf#page=5$/);
  await tab.screenshot({ path: resolve(dir, 'tra-cuu-desktop.png') });

  await tab.locator('#task').fill('Căn cứ phản hồi thông báo thẩm định nhãn hiệu, đối chiếu ngày 11/10/2026, cơ quan tiếp nhận ngày 12/09/2026?');
  await tab.locator('#ask-date').fill('');
  await click(tab, 'Gửi yêu cầu');
  await tab.getByRole('heading', { name: 'Điều 83 khoản 2 điểm b' }).waitFor();
  assert.match(await tab.getByRole('link', { name: 'Mở đúng trang' }).getAttribute('href'), /\.pdf#page=102$/);
  await click(tab, 'Dùng căn cứ cho hồ sơ mới');
  await tab.locator('#research-intake').waitFor();
  assert.equal(await tab.locator('[name=asOf]').inputValue(), '2026-10-11');
  assert.equal(await tab.locator('[name=receivedOn]').inputValue(), '2026-09-12');
  await tab.locator('[name=reference]').fill(reference);
  await tab.locator('[name=title]').fill(entry.title);
  await tab.locator('[name=notice]').fill(entry.notice.text);
  await tab.locator('[name=instructions]').fill(entry.instructions.text);
  await tab.locator('[name=anonymized]').check();
  await click(tab, 'Lưu hồ sơ');
  await tab.locator('#research-saved').waitFor();
  id = new URL(tab.url()).searchParams.get('case');
  assert.ok(id);
  await generate(tab, entry.draft, 1);
  for (const section of ['findings', 'response', 'attachments']) {
    await ready(tab);
    await tab.locator('[data-section=' + section + ']').getByRole('button', { name: 'Duyệt phần này' }).click();
  }
  firstHash = await download(tab, 1);
  await first.context.close();

  const second = await page({ width: 1440, height: 960 });
  await second.tab.goto(workspace + '?case=' + id);
  await second.tab.locator('#research-saved').waitFor();
  await click(second.tab, 'Xem căn cứ');
  await second.tab.getByRole('heading', { name: 'Căn cứ đã lưu' }).waitFor();
  assert.match(await second.tab.getByRole('link', { name: 'Mở đúng trang' }).getAttribute('href'), /\.pdf#page=102$/);
  await click(second.tab, 'Đóng cửa sổ');
  await click(second.tab, 'Dán nguồn');
  await second.tab.getByLabel('Tên nguồn').fill(entry.update.label);
  await second.tab.getByRole('textbox', { name: 'Nội dung nguồn', exact: true }).fill(entry.update.text);
  await click(second.tab, 'Thêm vào ô giao việc');
  await second.tab.locator('[data-section=response]').getByRole('button', { name: 'Giao AI sửa' }).click();
  await generate(second.tab, entry.revise, 2);
  await second.tab.locator('[data-section=response]').getByRole('button', { name: 'Duyệt phần này' }).click();
  const secondHash = await download(second.tab, 2);
  assert.notEqual(firstHash, secondHash);
  const response = await second.context.request.get(base + '/api/m3/cases/' + id);
  assert.equal(response.status(), 200);
  const state = await response.json();
  assert.equal(state.releases.length, 2);
  assert.equal(state.releases[0].research.proofId, state.releases[1].research.proofId);
  assert.equal(state.releases[1].sections.findings.draft, 1);
  assert.equal(state.releases[1].sections.attachments.draft, 1);
  assert.equal(state.releases[1].sections.response.draft, 2);
  assert.ok(state.releases[1].sections.response.text.includes(entry.next));
  const previous = await second.context.request.get(base + '/api/m4/cases/' + id + '/word/1/daitin-v2');
  assert.equal(hash(await previous.body()), firstHash);
  await second.tab.screenshot({ path: resolve(dir, 'ho-so-desktop.png') });
  await second.context.close();

  const mobile = await page({ width: 390, height: 844 });
  await mobile.tab.goto(workspace);
  await mobile.tab.locator('#research-paper').waitFor();
  await mobile.tab.locator('#task').fill('Điều 83 khoản 2 điểm b Thông tư 10/2026/TT-BKHCN');
  await mobile.tab.locator('#ask-anonymized').check();
  await click(mobile.tab, 'Gửi yêu cầu');
  await mobile.tab.getByRole('heading', { name: 'Điều 83 khoản 2 điểm b' }).first().waitFor();
  assert.equal(await mobile.tab.evaluate(() => document.documentElement.scrollWidth), 390);
  await mobile.tab.screenshot({ path: resolve(dir, 'tra-cuu-mobile.png') });
  await mobile.context.close();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ phases: 2, researchSaved: true, hashStable: true, firstHash, secondHash, browserErrors: errors }));
} finally {
  await browser.close();
}
