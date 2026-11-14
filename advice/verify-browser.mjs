import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { prompts } from './engine.mjs';

const [origin, privateDir, concept, screenshot] = process.argv.slice(2);
const { chromium } = await import(pathToFileURL(process.env.DAI_TIN_PLAYWRIGHT).href);
const { sources } = JSON.parse(readFileSync(resolve(privateDir, 'word.json'), 'utf8'));
const [reviewer, editor] = JSON.parse(readFileSync(resolve(privateDir, 'accounts.json'), 'utf8'));
const errors = [];
const questionVN = prompts[0].replace('POA', 'POA (power of Attorney)');
const questionTH = prompts[1].replace('POA', 'POA (power of Attorney)');
const unauthorized = await fetch(origin + '/api/advice/config');
assert.equal(unauthorized.status, 401);
const askAs = (account, body, requestOrigin = origin) => fetch(origin + '/api/advice/ask', {
  method: 'POST',
  headers: {
    Authorization: 'Basic ' + Buffer.from(account.name + ':' + account.key).toString('base64'),
    'Content-Type': 'application/json',
    Origin: requestOrigin,
  },
  body: JSON.stringify(body),
});
const sample = { query: questionVN, scenario: 'word' };
assert.equal((await askAs(editor, sample)).status, 403);
assert.equal((await askAs(reviewer, sample, 'https://unrelated.test')).status, 403);
assert.equal((await askAs(reviewer, { ...sample, scenario: 'invalid' })).status, 400);

const browser = await chromium.launch({ executablePath: process.env.DAI_TIN_CHROME });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(7000);
  await page.goto(origin + '/advice/');
  await page.locator('#username').fill(reviewer.name);
  await page.locator('#key').fill(reviewer.key);
  await page.getByRole('button', { name: 'Mở Hỏi đáp nghiệp vụ' }).click();
  await page.getByRole('heading', { name: 'Hỏi đáp sở hữu trí tuệ' }).waitFor();

  async function ask(question, title) {
    await page.locator('#query').fill(question);
    await page.getByRole('button', { name: 'Gửi câu hỏi' }).click();
    await page.locator('.turn').last().getByRole('heading', { name: title }).waitFor();
    return page.locator('.turn').last();
  }
  async function copy(turn, label) {
    await turn.getByRole('button', { name: label }).click();
    await turn.getByText('Đã sao chép').waitFor();
    return page.evaluate(() => navigator.clipboard.readText());
  }

  const vn = await ask(questionVN, 'Có, theo hướng dẫn trong Word');
  await vn.getByRole('button', { name: '[1] Word', exact: true }).click();
  assert.equal(await page.locator('.source-quote').innerText(), sources[0].quote);
  assert.match(await page.locator('.source-location').innerText(), /Documents required · Đoạn Word 3817$/);
  const draft = await copy(vn, 'Sao chép email');
  assert.match(draft, /người đại diện theo pháp luật của chủ sở hữu nhãn hiệu/);
  assert.match(await vn.innerText(), /chưa ghi ngày xác nhận/);
  assert.match(draft, /Yêu cầu áp dụng tại thời điểm nộp hồ sơ cần được xác nhận/);
  assert.doesNotMatch(draft, /Potential Advice|Đoạn Word/);
  assert.doesNotMatch(draft, /MÔ PHỎNG/);

  const th = await ask(questionTH, 'Chưa đủ căn cứ để kết luận');
  await th.getByRole('button', { name: '[1] Word · Tham chiếu', exact: true }).click();
  assert.equal(await page.locator('.source-quote').innerText(), sources[1].quote);
  assert.match(await page.locator('.source-location').innerText(), /Patent › Registration · Đoạn Word 11153$/);
  assert.match(await copy(th, 'Sao chép thư xác nhận'), /Nhờ anh\/chị xác nhận/);
  assert.equal(await th.getByRole('button', { name: 'Sao chép email' }).count(), 0);

  await page.locator('summary').click();
  await page.getByRole('button', { name: 'Email cập nhật' }).click();
  await page.getByRole('heading', { name: 'Có, trong trường hợp nộp qua đối tác mô phỏng' }).waitFor();
  const vnUpdated = await ask(questionVN, 'Có thể dùng POA đã lưu nếu còn phù hợp');
  await vnUpdated.getByRole('button', { name: '[2] Word', exact: true }).click();
  assert.equal(await page.locator('.source-quote').innerText(), sources[0].quote);
  assert.match(await page.locator('.source-sheet .tag').innerText(), /Đã được thay thế trong diễn tập/);
  assert.match(await copy(vnUpdated, 'Sao chép email'), /^\[MÔ PHỎNG/);

  await page.getByRole('button', { name: 'Nguồn mâu thuẫn' }).click();
  await page.locator('.turn').last().getByRole('heading', { name: 'Các nguồn đang mâu thuẫn' }).waitFor();
  const conflict = await ask(questionTH, 'Các nguồn đang mâu thuẫn');
  await conflict.getByRole('button', { name: '[1] Email', exact: true }).click();
  assert.match(await page.locator('.source-quote').innerText(), /A fresh signed POA is required/);
  await page.locator('#source-tabs').getByRole('button', { name: '[2] Email' }).click();
  assert.match(await page.locator('.source-quote').innerText(), /No fresh POA is needed/);
  assert.match(await copy(conflict, 'Sao chép thư xác nhận'), /^\[MÔ PHỎNG/);

  await page.getByRole('button', { name: 'Đăng xuất' }).click();
  await page.locator('#username').waitFor();
  assert.equal((await page.request.get(origin + '/api/advice/config')).status(), 401);
  await context.close();

  if (concept) {
    const url = pathToFileURL(resolve(concept)).href;
    const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    desktop.on('pageerror', error => errors.push(error.message));
    await desktop.goto(url);
    await desktop.getByRole('heading', { name: 'Có, theo hướng dẫn trong Word' }).waitFor();
    await desktop.evaluate(() => document.fonts.ready);
    if (screenshot) await desktop.screenshot({ path: screenshot });
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    phone.on('pageerror', error => errors.push(error.message));
    await phone.goto(url);
    await phone.locator('.citations button').click({ timeout: 7000 });
    await phone.getByRole('button', { name: 'Đóng căn cứ' }).click({ timeout: 7000 });
    assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth), 390);
    assert.equal(await phone.evaluate(() => document.activeElement?.textContent), '[1] Word');
  }
  assert.deepEqual(errors, []);
  console.log('M9 browser passed: Word quotes, date labels, simulated update and conflict, actual clipboard, login, logout, API access, desktop and mobile.');
} finally {
  await browser.close();
}
