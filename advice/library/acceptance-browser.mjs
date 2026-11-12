import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [origin, data, receiptPath, out, screenshot] = process.argv.slice(2);
const receipt = JSON.parse(readFileSync(receiptPath));
const account = JSON.parse(readFileSync(resolve(data, 'accounts.json'))).find(row => row.role === 'reviewer');
const corpus = JSON.parse(readFileSync(new URL('./index.json', import.meta.url))).rows;
const { chromium } = await import(pathToFileURL(process.env.DAI_TIN_PLAYWRIGHT).href);
const browser = await chromium.launch({ executablePath: process.env.DAI_TIN_CHROME });
const directHarness = `<!doctype html><html lang="vi"><meta charset="utf-8"><title>Agent trực tiếp</title>
<form id="ask"><label>Câu hỏi <textarea id="question" required></textarea></label><button>Gửi</button></form>
<article hidden id="output"><h1>Kết quả</h1><p id="answer"></p><p id="ids"></p><pre id="email"></pre>
<button type="button" id="copy">Sao chép email</button><span role="status" id="copied"></span>
<form id="source"><label>Mã đoạn <input id="code" required></label><button>Mở đoạn nguồn</button></form><blockquote id="quote"></blockquote></article>
<script>
  const el = id => document.getElementById(id);
  el('ask').onsubmit = event => {
    event.preventDefault();
    if (el('question').value !== window.run.query) return;
    el('answer').textContent = window.run.answer;
    el('email').textContent = window.run.email;
    el('ids').textContent = window.run.ids.join(' · ');
    el('output').hidden = false;
  };
  el('copy').onclick = async () => {
    await navigator.clipboard.writeText(window.run.email);
    el('copied').textContent = 'Đã sao chép';
  };
  el('source').onsubmit = event => {
    event.preventDefault();
    el('quote').textContent = window.docs.find(doc => doc.id === el('code').value)?.quote ?? '';
  };
</script></html>`;

async function startApp(page) {
  await page.goto(origin + '/advice/');
  if (await page.locator('#username').count()) {
    await page.locator('#username').fill(account.name);
    await page.locator('#key').fill(account.key);
    await page.getByRole('button', { name: 'Mở Hỏi đáp nghiệp vụ' }).click();
  }
  await page.getByRole('heading', { name: 'Anh cần tra cứu việc gì?' }).waitFor();
}

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  const app = await context.newPage();
  await startApp(app);
  let current;
  await app.route('**/api/advice/research', route => {
    const { query, scenario } = route.request().postDataJSON();
    if (!current || query !== current.query || scenario !== current.scenario) return route.abort();
    return route.fulfill({ json: current.workspace });
  });
  const direct = await context.newPage();
  await direct.route(origin + '/agent-benchmark', route => route.fulfill({ contentType: 'text/html', body: directHarness }));
  const counts = [];
  let scenario = 'library';
  let captured = false;
  for (const row of receipt.rows) {
    if (!row.workspace.grade.pass || !row.direct.grade.pass) continue;
    current = row;
    const [caseId, question] = [row.id, row.query];
    let appActions = 0;
    let directActions = 0;
    const appStep = async action => { await action(); appActions++; };
    const directStep = async action => { await action(); directActions++; };
    await app.bringToFront();
    await app.getByRole('button', { name: /Cuộc hỏi đáp mới/ }).click();
    if (row.scenario !== scenario) {
      if ((await app.locator('#scenarios').getAttribute('open')) === null) await app.locator('#scenarios summary').click();
      const label = row.scenario === 'conflict' ? 'Nguồn mâu thuẫn' : row.scenario === 'updated' ? 'Email cập nhật' : 'Kho mô phỏng';
      await app.getByRole('button', { name: label, exact: true }).click();
      scenario = row.scenario;
    }
    await appStep(() => app.locator('#query').fill(question));
    await appStep(() => app.getByRole('button', { name: 'Gửi câu hỏi' }).click());
    await app.getByRole('heading', { name: row.workspace.title, exact: true }).waitFor();
    for (const id of row.sources) {
      const i = row.workspace.citations.findIndex(source => source.id === id);
      await appStep(() => app.locator('.citations button').nth(i).click());
      assert.equal(await app.locator('.source-quote').innerText(), corpus.find(source => source.id === id).quote, caseId);
    }
    if (row.workspace.email) {
      await appStep(() => app.getByRole('button', { name: row.expected === 'supported' ? 'Sao chép email' : 'Sao chép thư xác nhận', exact: true }).click());
      await app.getByText('Đã sao chép', { exact: true }).waitFor();
      assert.equal(await app.evaluate(() => navigator.clipboard.readText()), row.workspace.email);
    }
    if (screenshot && caseId === 'Q04') {
      const download = await app.request.get(origin + '/api/advice/source/sg-renew-poa');
      assert.equal(download.status(), 200);
      await app.getByRole('button', { name: 'Soạn email cho khách', exact: true }).click();
      const editor = app.getByRole('textbox', { name: 'Nội dung email có thể chỉnh sửa' });
      await editor.fill(row.workspace.email + '\nLuật sư rà lại trước khi gửi.');
      await app.getByRole('button', { name: 'Sao chép email', exact: true }).click();
      assert.match(await app.evaluate(() => navigator.clipboard.readText()), /Luật sư rà lại/);
      await app.evaluate(() => document.fonts.ready);
      await app.screenshot({ path: screenshot });
      captured = true;
    }
    await direct.bringToFront();
    await direct.goto(origin + '/agent-benchmark');
    await direct.evaluate(({ row, corpus }) => {
      window.run = { query: row.query, ...row.direct.run };
      window.docs = corpus.filter(source => source.layers.includes(row.scenario));
    }, { row, corpus });
    await directStep(() => direct.locator('#question').fill(question));
    await directStep(() => direct.getByRole('button', { name: 'Gửi', exact: true }).click());
    await direct.getByRole('heading', { name: 'Kết quả' }).waitFor();
    for (const id of row.sources) {
      await directStep(() => direct.locator('#code').fill(id));
      await directStep(() => direct.getByRole('button', { name: 'Mở đoạn nguồn' }).click());
      assert.equal(await direct.locator('#quote').innerText(), corpus.find(source => source.id === id).quote, caseId);
    }
    if (row.workspace.email) {
      await directStep(() => direct.getByRole('button', { name: 'Sao chép email' }).click());
      await direct.getByText('Đã sao chép', { exact: true }).waitFor();
      assert.equal(await direct.evaluate(() => navigator.clipboard.readText()), row.direct.email);
    }
    counts.push({ id: caseId, appActions, directActions, reviewedSources: row.sources.length });
  }
  if (screenshot && !captured) throw new Error('Thiếu ca cập nhật để kiểm soạn thư và chụp giao diện.');
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 1, hasTouch: true,
    storageState: await context.storageState() });
  const mobile = await phone.newPage();
  await startApp(mobile);
  const row = receipt.rows[0];
  await mobile.route('**/api/advice/research', route => route.fulfill({ json: row.workspace }));
  await mobile.locator('#query').fill(row.query);
  await mobile.getByRole('button', { name: 'Gửi câu hỏi' }).click();
  await mobile.getByText('Dữ liệu mô phỏng', { exact: true }).waitFor();
  await mobile.locator('.citations button').first().click();
  await mobile.getByRole('button', { name: 'Đóng căn cứ' }).click();
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth), 390);
  assert.equal(await mobile.evaluate(() => document.activeElement.textContent), '[1] Word');
  const totals = counts.reduce((sum, row) => ({
    app: sum.app + row.appActions, direct: sum.direct + row.directActions,
    directWithCitationLinks: sum.directWithCitationLinks + row.directActions - row.reviewedSources,
  }), { app: 0, direct: 0, directWithCitationLinks: 0 });
  const result = { pairedPasses: counts.length, totals, counts, method: 'Playwright, phát lại kết quả model đã ghi nhận' };
  writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
