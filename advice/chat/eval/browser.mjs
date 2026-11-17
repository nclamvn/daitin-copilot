import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { threads } from './cases.mjs';

const [origin, directory, accounts, privateOrigin, privateAccounts] = process.argv.slice(2);
const { chromium } = await import(pathToFileURL(process.env.DAI_TIN_PLAYWRIGHT).href);
const browser = await chromium.launch({ executablePath: process.env.DAI_TIN_CHROME });
const results = [];
const errors = [];
const stats = () => ({ actions: 0, automationMs: 0, waitMs: 0 });
async function measure(row, callback, waiting = false) {
  const start = performance.now();
  if (!waiting) row.actions++;
  const out = await callback();
  row[waiting ? 'waitMs' : 'automationMs'] += Math.round(performance.now() - start);
  return out;
}

async function signIn(base, file) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const reviewer = JSON.parse(readFileSync(file, 'utf8')).find(row => row.role === 'reviewer');
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/advice/');
  await page.getByLabel('Tài khoản', { exact: true }).fill(reviewer.name);
  await page.getByLabel('Khóa truy cập pilot', { exact: true }).fill(reviewer.key);
  await page.getByRole('button', { name: 'Mở Hỏi đáp nghiệp vụ' }).click();
  await page.getByRole('button', { name: 'Thư khách', exact: true }).waitFor();
  return { context, page };
}

async function ask(page, query, row) {
  await measure(row, () => page.getByLabel('Câu hỏi của anh').fill(query));
  const response = page.waitForResponse(reply => reply.url().endsWith('/api/advice/chat'));
  await measure(row, () => page.getByRole('button', { name: /Gửi câu hỏi/ }).click());
  const reply = await measure(row, () => response, true);
  assert.equal(reply.status(), 200, await reply.text());
  return reply.json();
}

async function sourceEvent(context, fixture, stage, older) {
  const base = privateOrigin + '/api/advice/private/';
  const api = async (path, data) => {
    const response = await context.request.fetch(base + path, data && { method: 'POST', headers: { Origin: privateOrigin }, data });
    assert.equal(response.status(), 200, await response.text());
    return response.json();
  };
  const replacement = fixture.sourceEvent === 'replacement';
  const scope = replacement ? ['th', 'pt', 'annuity', 'poa'] : ['vn', 'tm', 'renew', 'poa'];
  const statement = !replacement ? 'Diễn tập. Hãng cho rằng không cần POA khi nộp qua đại diện.' : stage === 1
    ? 'Diễn tập. Hãng đề nghị chuẩn bị POA đã ký khi nộp qua hãng.'
    : 'Diễn tập. Hãng đề nghị xác nhận riêng với DIP trước khi yêu cầu khách ký POA.';
  const value = !replacement ? 'none' : stage === 1 ? 'agent-signed' : 'verify-office-record';
  const base64 = Buffer.from('From: fixture@example.test\r\nTo: pilot@example.test\r\nSubject: M20 fixture\r\n' +
    'Content-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n' + statement).toString('base64');
  const { sha } = await api('import', { name: 'Partner-' + fixture.id + '-' + stage + '.eml', owner: 'Diễn tập M20',
    permission: 'Tệp hoàn toàn mô phỏng dùng cho nghiệm thu.', base64, allowed: true });
  const doc = await api('document/' + sha);
  const para = doc.paragraphs.find(item => item.quote === statement);
  assert.ok(para);
  const { id } = await api('approve', { sha, paragraph: para.paragraph, digest: para.digest, confirmed: true,
    scope, statement, value, issuer: 'partner-m20', date: stage === 1 ? '2026-10-12' : '2026-11-17',
    ...(older ? { supersedes: older } : {}) });
  return id;
}

try {
  const { context, page: publicPage } = await signIn(origin, accounts);
  const { context: local, page: privatePage } = await signIn(privateOrigin, privateAccounts);
  for (const fixture of threads) {
    const privateCase = Boolean(fixture.sourceEvent);
    const page = privateCase ? privatePage : publicPage;
    await page.getByRole('button', { name: /Cuộc hỏi đáp mới/ }).click();
    const older = fixture.sourceEvent === 'replacement' ? await sourceEvent(local, fixture, 1) : null;
    for (const [index, question] of [fixture.first, fixture.next].entries()) {
      const row = { id: fixture.id, session: index + 1, ...stats() };
      if (index) {
        await measure(row, () => page.reload(), true);
        await measure(row, () => page.getByRole('button', { name: 'Mở bản thư đã lưu' }).click());
        if (privateCase) {
          // Changed source must block export of the old reviewed sections.
          await sourceEvent(local, fixture, 2, older);
          const reviewer = page.locator('#chat-draft');
          await measure(row, () => reviewer.getByRole('button', { name: 'Sao chép thư khách' }).click());
          await reviewer.getByText('Căn cứ đã đổi. Các mục bị ảnh hưởng cần duyệt lại.').waitFor();
        }
      }
      const result = await ask(page, question, row);
      const ids = new Set(result.sections.flatMap(section => section.pending ? ['?'] : section.ids));
      assert.ok(fixture.expected[index].every(id => ids.has(id)), JSON.stringify([fixture.id, index + 1, [...ids]]));
      const card = page.locator('.turn').last();
      const cite = card.locator('.citations button').first();
      if (await cite.count()) {
        await measure(row, () => cite.click());
        await page.locator('#source-detail blockquote').waitFor();
        if (!index && fixture.id === 'E05') await page.screenshot({ path: join(directory, '01-chat-can-cu.png') });
        await measure(row, () => page.getByRole('button', { name: /Đóng căn cứ/ }).click());
      }
      await measure(row, () => card.getByRole('button', { name: 'Duyệt bản thư' }).click());
      const draft = page.locator('#chat-draft');
      if (index && fixture.keep) {
        const position = result.draft.sections.findIndex(item => item.id === fixture.keep);
        assert.ok(position >= 0 && await draft.getByRole('checkbox').nth(position).isChecked(), fixture.id + ' approval');
      }
      if (index && ['E01', 'E05'].includes(fixture.id)) {
        const yearly = result.draft.sections.findIndex(item => item.id === 'th-annuity:fee');
        assert.equal(await draft.getByRole('checkbox').nth(yearly).isChecked(), false);
      }
      if (!index && fixture.id === 'E01') {
        const input = draft.locator('textarea').first();
        await measure(row, () => input.fill('Hồ sơ chuẩn bị theo mẫu 010-Kor. ' + result.draft.sections[0].text));
      }
      const checks = await draft.getByRole('checkbox').all();
      if (index && fixture.id === 'E05') await page.screenshot({ path: join(directory, '02-duyet-phien-hai.png') });
      for (const [hasPending, name] of [[false, /sao chép thư khách/i], [true, /sao chép thư xác nhận/i]]) {
        const indices = result.draft.sections.flatMap((item, i) => item.pending === hasPending ? [i] : []);
        if (!indices.length) continue;
        const remaining = [];
        for (const i of indices) if (!await checks[i].isChecked()) remaining.push(i);
        for (const i of remaining.slice(0, -1)) await measure(row, () => checks[i].check());
        await measure(row, () => draft.getByRole('button', { name }).click());
        for (const i of indices) assert.ok(await checks[i].isChecked());
        await measure(row, () => draft.getByRole('status').getByText(/Đã sao chép bản/).waitFor(), true);
        const copied = await page.evaluate(() => navigator.clipboard.readText());
        assert.ok(copied.trim().endsWith('Trân trọng,'));
        for (const part of result.draft.sections.filter(item => item.pending === hasPending)) assert.ok(copied.includes(part.title));
        if (index && fixture.id === 'E01') assert.doesNotMatch(copied, /2\.200 THB/);
      }
      if (index && fixture.id === 'E12') assert.equal(result.citations.find(item => item.id === older)?.state, 'superseded');
      results.push(row);
      console.log(row.id, row.session, row.actions);
    }
  }
  await context.close();
  await local.close();
  assert.deepEqual(errors, []);
  writeFileSync(join(directory, 'browser.json'), JSON.stringify({ simulation: true, source: 'Chrome loopback', timing: 'automation only', results }, null, 2));
} finally { await browser.close(); }
