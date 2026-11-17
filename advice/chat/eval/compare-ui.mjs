import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const [origin, blindFile, answerKeyFile, browserFile, report] = process.argv.slice(2);
const { chromium } = await import(pathToFileURL(process.env.DAI_TIN_PLAYWRIGHT).href);
const load = path => JSON.parse(readFileSync(path, 'utf8'));
const { submissions, corpora } = load(blindFile);
const keys = load(answerKeyFile);
const workspace = load(browserFile).results;
const html = `<!doctype html><html lang="vi"><meta charset="utf-8"><title>Đối chứng hỏi trực tiếp</title>
<style>body{font:16px system-ui;max-width:750px;margin:2rem auto} textarea{width:100%;font:inherit}
form,section,details{margin-block:1rem} button{margin-block:.5rem;font:inherit}</style>
<h1>Hỏi trực tiếp</h1><button id="resume" hidden>Mở trao đổi đã lưu</button>
<form hidden><label>Thư hoặc câu hỏi<textarea rows="3" required></textarea></label><button>Gửi</button></form>
<div id="response"></div><p role="status"></p>
<script>
const form = document.querySelector('form');
const response = document.querySelector('#response');
const resume = document.querySelector('#resume');
const notice = document.querySelector('[role=status]');
let sample;
window.loadCase = data => { sample = data; form.hidden = data.session === 2; resume.hidden = !form.hidden; };
resume.onclick = () => {
  const older = localStorage.getItem('direct:' + sample.case) || '';
  if (older) {
    const prior = document.createElement('p');
    prior.textContent = 'Đã mở bản phiên trước.';
    resume.replaceWith(prior);
  }
  form.hidden = false;
};
form.onsubmit = event => {
  event.preventDefault();
  if (form.querySelector('textarea').value !== sample.query) return;
  const answer = document.createElement('p');
  answer.textContent = sample.answer;
  response.append(answer);
  const first = sample.sources.find(row => row.id === sample.citations[0]);
  if (first) {
    const source = document.createElement('details');
    const summary = document.createElement('summary');
    const quote = document.createElement('blockquote');
    summary.textContent = 'Mở đoạn căn cứ';
    quote.textContent = first.quote;
    source.append(summary,quote); response.append(source);
  }
  for (const [field, label] of [['client','thư khách'],['verification','thư xác nhận']]) {
    if (!sample[field]) continue;
    const section = document.createElement('section');
    const draft = document.createElement('textarea');
    draft.rows = 4;
    draft.value = sample[field];
    draft.setAttribute('aria-label', label);
    const copy = document.createElement('button');
    copy.textContent = 'Sao chép ' + label;
    copy.onclick = async () => {
      localStorage.setItem('direct:' + sample.case, draft.value);
      await navigator.clipboard.writeText(draft.value);
      notice.textContent = 'Đã sao chép ' + label;
    };
    section.append(draft,copy);response.append(section);
  }
};
</script>`;
const browser = await chromium.launch({ executablePath: process.env.DAI_TIN_CHROME });
const measurements = [];
try {
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  await context.route(origin + '/m20-direct-eval', route => route.fulfill({ contentType: 'text/html', body: html }));
  const relevant = keys.filter(row => row.arm === 'direct' && row.case.startsWith('E') && row.model)
    .sort((a, b) => a.case.localeCompare(b.case) || a.session - b.session);
  for (const row of relevant) {
    const item = submissions.find(entry => entry.code === row.code);
    const page = await context.newPage();
    const metric = { case: row.case, session: row.session, actions: 0, automationMs: 0, directStructuralPass: row.checked };
    const action = async run => {
      const start = performance.now();
      await run();
      metric.actions++;
      metric.automationMs += Math.round(performance.now() - start);
    };
    await page.goto(origin + '/m20-direct-eval');
    await page.evaluate(data => window.loadCase(data), { ...item, sources: corpora[item.sourceHash] });
    if (row.session === 2) await action(() => page.getByRole('button', { name: 'Mở trao đổi đã lưu' }).click());
    await action(() => page.getByLabel('Thư hoặc câu hỏi').fill(item.query));
    await action(() => page.getByRole('button', { name: 'Gửi' }).click());
    const source = page.getByText('Mở đoạn căn cứ', { exact: true });
    if (await source.count()) {
      await action(() => source.click());
      await page.locator('blockquote').waitFor();
      await action(() => source.click());
    }
    for (const [field, label] of [['client','thư khách'],['verification','thư xác nhận']]) {
      if (!item[field]) continue;
      await action(() => page.getByRole('button', { name: 'Sao chép ' + label }).click());
      await page.getByRole('status').getByText('Đã sao chép ' + label, { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), item[field]);
    }
    await page.close();
    const product = workspace.find(entry => entry.id === row.case && entry.session === row.session);
    const evaluated = keys.find(entry => entry.arm === 'workspace' && entry.case === row.case && entry.session === row.session);
    measurements.push({ ...metric, productActions: product?.actions, productAutomationMs: product?.automationMs,
      productStructuralPass: evaluated?.checked, modelWaitMs: { direct: row.elapsedMs, workspace: evaluated?.elapsedMs ?? null } });
  }
  writeFileSync(report, JSON.stringify({ method: 'Chrome: replay direct model outputs, open one cited passage and copy outputs. Workspace browser simulation includes section approval. No repair or real human time.', measurements }, null, 2) + '\n');
} finally { await browser.close(); }
