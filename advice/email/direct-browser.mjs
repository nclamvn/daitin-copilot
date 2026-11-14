import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { emailCases } from './cases.mjs';
import { planEmail, topics } from './plan.mjs';
import { procedureSources } from '../public/answer.mjs';
import { suggestMail } from '../ui/email.mjs';
import { mailFromSections } from './grade.mjs';

const [origin, directory] = process.argv.slice(2);
const { chromium } = await import(pathToFileURL(process.env.DAI_TIN_PLAYWRIGHT).href);
const rows = readFileSync(directory + '/benchmark.jsonl', 'utf8').trim().split('\n').map(JSON.parse)
  .filter(row => row.arm === 'direct');
assert.equal(rows.length, 16);
const browser = await chromium.launch({ executablePath: process.env.DAI_TIN_CHROME });
const metrics = [];
// An intentionally simple direct-agent surface: one saved thread, one prompt,
// one source browser and one editable draft per recipient. Model calls are replayed.
const html = `<!doctype html><html lang="vi"><meta charset="utf-8"><title>Agent trực tiếp</title>
<style>body{font:16px system-ui;max-width:800px;margin:30px auto} textarea{width:100%;font:inherit}
button,select{font:inherit;margin:7px 5px 7px 0} article{border:1px solid #ccc;padding:12px;margin-top:14px}</style>
<h1>Agent trực tiếp</h1><button id="open">Mở cuộc trao đổi</button>
<details id="prior" hidden><summary>Bản đã lưu ở phiên trước</summary><pre id="prior-text"></pre></details>
<form id="compose" hidden><label>Thư khách<textarea id="mail" rows="4" required></textarea></label><button>Giao việc</button></form>
<details id="pack" hidden><summary>Bộ nguồn đã khóa</summary><select aria-label="Mã đoạn" id="sources"></select><p id="quote"></p></details>
<form id="repair" hidden><label>Yêu cầu sửa<textarea id="instruction" rows="3" required></textarea></label><button>Yêu cầu agent sửa</button></form>
<div id="output"></div><p id="notice" role="status"></p>
<script>
let dataset;
let revision = 0;
document.querySelector('#open').onclick = () => {
  document.querySelector('#compose').hidden = false;
  const saved = JSON.parse(localStorage.getItem('direct:' + dataset.case) || '{}');
  const prior = Object.values(saved).join('\\n\\n');
  if (prior) {
    document.querySelector('#prior').hidden = false;
    document.querySelector('#prior-text').textContent = prior;
    document.querySelector('#notice').textContent = 'Đã mở bản lưu';
  }
};
document.querySelector('#compose').onsubmit = event => {
  event.preventDefault();
  const text = document.querySelector('#mail').value;
  if (text !== dataset.email) return;
  document.querySelector('#pack').hidden = false;
  const options = document.querySelector('#sources');
  options.replaceChildren(new Option('Chọn đoạn', ''), ...dataset.sources.map(source => new Option(source.id, source.id)));
  options.onchange = () => { document.querySelector('#quote').textContent = dataset.sources.find(row => row.id === options.value)?.statement ?? ''; };
  renderDrafts(dataset.first);
  document.querySelector('#repair').hidden = !dataset.revisions.length;
};
document.querySelector('#repair').onsubmit = event => {
  event.preventDefault();
  const next = dataset.revisions[revision];
  const input = document.querySelector('#instruction');
  if (!next || next.kind !== 'agent' || next.prompt !== input.value) return;
  revision++;
  input.value = '';
  renderDrafts(next);
  document.querySelector('#repair').hidden = dataset.revisions[revision]?.kind !== 'agent';
};
function renderDrafts(drafts) {
  document.querySelector('#output').replaceChildren();
  for (const [key,label] of [['client','Trả lời khách'],['partner','Xác nhận với đối tác']]) {
    if (!drafts[key] && !dataset.final[key]) continue;
    const area = document.createElement('article');
    const title = document.createElement('h2'); title.textContent = label;
    const edit = document.createElement('textarea');
    edit.rows = 6; edit.value = drafts[key]; edit.setAttribute('aria-label',label);
    const copy = document.createElement('button');
    copy.textContent = 'Lưu và sao chép ' + label.toLowerCase();
    copy.onclick = async () => {
      const stored = JSON.parse(localStorage.getItem('direct:' + dataset.case) || '{}');
      stored[dataset.session + ':' + key] = edit.value;
      localStorage.setItem('direct:' + dataset.case, JSON.stringify(stored));
      await navigator.clipboard.writeText(edit.value);
      document.querySelector('#notice').textContent = 'Đã sao chép ' + label.toLowerCase();
    };
    area.append(title,edit,copy); document.querySelector('#output').append(area);
  }
  document.querySelector('#notice').textContent = drafts.client || drafts.partner ? 'Đã mở bản nháp' : 'Không có bản nháp';
}
window.loadCase = input => { dataset = input; if (input.session === 1) document.querySelector('#compose').hidden = false; };
</script>`;
try {
  const context = await browser.newContext({ permissions: ['clipboard-read','clipboard-write'] });
  await context.route(origin + '/m16-direct', route => route.fulfill({ contentType: 'text/html', body: html }));
  for (const row of rows) {
    const fixture = emailCases.find(item => item.id === row.fixture);
    const stats = { case: fixture.id, session: row.session, arm: 'direct', actions: 0, sourceActions: 0, automationMs: 0, waitMs: 0, outputs: {} };
    const page = await context.newPage();
    page.setDefaultTimeout(7000);
    const step = async (operation, active = true) => {
      const start = performance.now();
      await operation();
      if (active) stats.actions++;
      stats[active ? 'automationMs' : 'waitMs'] += Math.round(performance.now() - start);
    };
    await step(() => page.goto(origin + '/m16-direct'), false);
    const sources = procedureSources(fixture.topic);
    const email = row.session === 1 ? fixture.first : fixture.next;
    const input = suggestMail(email, row.session === 2 ? suggestMail(fixture.first) : undefined);
    const titles = new Map(planEmail(input).sections.map(section => [section.id, section.title]));
    const topic = topics[fixture.topic].label;
    const renderMail = sections => {
      const titled = sections.map(section => ({ ...section, title: titles.get(section.id) }));
      return { client: mailFromSections(titled, topic, false), partner: mailFromSections(titled, topic, true) };
    };
    const first = renderMail(row.sections);
    const revisions = (row.revisions ?? []).map(item => ({ ...item, ...renderMail(item.sections) }));
    const final = revisions.at(-1) ?? first;
    await page.evaluate(data => window.loadCase(data), { case: fixture.id, session: row.session, email, sources, first, revisions, final });
    if (row.session === 2) {
      await step(() => page.getByRole('button', { name: 'Mở cuộc trao đổi' }).click());
      const prior = page.getByText('Bản đã lưu ở phiên trước', { exact: true });
      if (await prior.isVisible()) await step(() => prior.click());
    }
    await step(() => page.getByRole('textbox', { name: 'Thư khách' }).fill(email));
    await step(() => page.getByRole('button', { name: 'Giao việc' }).click());
    const priorRow = row.session === 2 ? rows.find(item => item.fixture === row.fixture && item.session === 1) : undefined;
    const prior = priorRow?.revisions?.at(-1)?.sections ?? priorRow?.sections ?? [];
    const changed = row.sections.filter(item => !prior?.some(old => old.id === item.id &&
      old.text === item.text && old.pending === item.pending && JSON.stringify(old.ids) === JSON.stringify(item.ids)));
    let packOpen = false;
    const checkedSources = new Set();
    async function readSources(ids) {
      const next = [...new Set(ids)].filter(id => !checkedSources.has(id) && sources.some(source => source.id === id));
      if (!next.length) return;
      if (!packOpen) {
        await step(() => page.getByText('Bộ nguồn đã khóa', { exact: true }).click());
        packOpen = true;
        stats.sourceActions++;
      }
      for (const id of next) {
        await step(() => page.getByLabel('Mã đoạn').selectOption(id));
        assert.equal(await page.locator('#quote').innerText(), sources.find(source => source.id === id).statement);
        checkedSources.add(id);
        stats.sourceActions++;
      }
    }
    await readSources(changed.flatMap(item => item.ids));
    const beforeRepair = stats.actions;
    let currentSections = row.sections;
    for (const revision of revisions) {
      if (revision.kind === 'agent') {
        await step(() => page.getByRole('textbox', { name: 'Yêu cầu sửa' }).fill(revision.prompt));
        await step(() => page.getByRole('button', { name: 'Yêu cầu agent sửa' }).click());
        await readSources(revision.sections.filter(item => !currentSections.some(old => old.id === item.id &&
          old.text === item.text && old.pending === item.pending && JSON.stringify(old.ids) === JSON.stringify(item.ids))).flatMap(item => item.ids));
      } else {
        await readSources(revision.sections.filter(item => revision.tips.some(tip => tip.id === item.id)).flatMap(item => item.ids));
        for (const [audience, label] of [['client', 'Trả lời khách'], ['partner', 'Xác nhận với đối tác']]) {
          const draft = page.getByRole('textbox', { name: label, exact: true });
          if (await draft.count() && await draft.inputValue() !== revision[audience]) {
            await step(() => draft.fill(revision[audience]));
          }
        }
      }
      currentSections = revision.sections;
    }
    stats.repairActions = stats.actions - beforeRepair;
    stats.agentRevisions = revisions.filter(item => item.kind === 'agent').length;
    stats.manualRevisions = revisions.filter(item => item.kind === 'manual').length;
    stats.repairModelMs = revisions.reduce((sum, item) => sum + (item.model?.elapsedMs ?? 0), 0);
    for (const [key, label] of [['client','Trả lời khách'], ['partner','Xác nhận với đối tác']]) {
      if (!final[key]) continue;
      const draft = page.getByRole('textbox', { name: label, exact: true });
      assert.equal(await draft.inputValue(), final[key]);
      const needsEdit = key === (final.client ? 'client' : 'partner') && !stats.manualRevisions;
      const revised = final[key] + (needsEdit ? '\nVui lòng đối chiếu dữ kiện trước khi thực hiện.' : '');
      if (needsEdit) await step(() => draft.fill(revised));
      await step(() => page.getByRole('button', { name: 'Lưu và sao chép ' + label.toLowerCase() }).click());
      await step(() => page.getByText('Đã sao chép ' + label.toLowerCase(), { exact: true }).waitFor(), false);
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), revised);
      stats.outputs[key] = revised;
    }
    stats.sections = currentSections;
    metrics.push(stats);
    await page.close();
  }
  await context.close();
  writeFileSync(directory + '/direct-browser.json', JSON.stringify(metrics, null, 2) + '\n', { mode: 0o600 });
  console.log('Verified direct-agent UI', metrics.length, 'sessions.');
} finally { await browser.close(); }
