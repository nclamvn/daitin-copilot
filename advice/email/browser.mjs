import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { emailCases } from './cases.mjs';
import { pilotCases } from './m18-cases.mjs';
import { m18Sources } from './m18-sources.mjs';

const [origin, directory] = process.argv.slice(2);
const m18 = process.argv.includes('--m18');
const { chromium } = await import(pathToFileURL(process.env.DAI_TIN_PLAYWRIGHT).href);
const accountsFile = process.env.DAI_TIN_TEST_ACCOUNTS ?? directory + '/local/accounts.json';
const account = JSON.parse(readFileSync(accountsFile, 'utf8')).find(row =>
  row.role === 'reviewer' && (!process.env.DAI_TIN_TEST_REVIEWER || row.name === process.env.DAI_TIN_TEST_REVIEWER));
assert.ok(account, 'Cần tài khoản nghiệm thu có quyền rà.');
const browser = await chromium.launch({ executablePath: process.env.DAI_TIN_CHROME });
const rows = [];
const errors = [];
const browserWidth = Number(process.env.DAI_TIN_TEST_WIDTH ?? 1440);
const step = async (stats, action, kind = 'action') => {
  const start = performance.now();
  await action();
  if (kind === 'action') stats.actions++;
  stats[kind === 'action' ? 'automationMs' : 'waitMs'] += Math.round(performance.now() - start);
};
const metrics = () => ({ actions: 0, automationMs: 0, waitMs: 0 });
try {
  const context = await browser.newContext({ viewport: { width: browserWidth, height: 900 }, permissions: ['clipboard-read','clipboard-write'] });
  let page = await context.newPage();
  page.setDefaultTimeout(30000);
  const attach = tab => {
    tab.on('pageerror', error => errors.push(error.message));
    tab.on('request', request => {
      if (!request.url().endsWith('/api/advice/email-plan')) return;
      const body = request.postDataJSON();
      assert.ok(Object.keys(body).every(key =>
        ['fields','filingYear','poa','topic','year','poaAlso','exactDeadline','unclearFilingDate','partnerIssuer'].includes(key)));
    });
  };
  attach(page);
  await page.goto(origin + '/advice/');
  await page.getByLabel('Tài khoản', { exact: true }).fill(account.name);
  await page.getByLabel('Khóa truy cập pilot', { exact: true }).fill(account.key);
  await page.getByRole('button', { name: 'Mở Hỏi đáp nghiệp vụ' }).click();
  try { await page.getByRole('button', { name: 'Thư khách', exact: true }).waitFor(); }
  catch (error) {
    console.log('Workspace entry', page.url(), await page.locator('#error').allTextContents(),
      (await page.locator('body').innerText()).slice(0, 360), errors);
    throw error;
  }
  if (m18) {
    await page.getByLabel('Câu hỏi của anh').fill('Gia hạn nhãn hiệu Việt Nam dùng mẫu tờ khai nào?');
    await page.getByRole('button', { name: /Gửi câu hỏi/ }).click();
    await page.locator('#turns').getByText(/Dùng Mẫu số 01/).waitFor();
  }
  const sources = m18 ? await m18Sources(async (path, body) => {
    const response = await context.request.fetch(origin + '/api/advice/private/' + path, body && { method: 'POST',
      headers: { Origin: origin }, data: body });
    assert.equal(response.status(), 200, await response.text());
    return response.json();
  }, readFileSync(new URL('../library/fixtures/vn-renew-poa.docx', import.meta.url))) : null;
  let screenshot = false;
  for (const fixture of m18 ? pilotCases : emailCases) {
    const title = fixture.first.split('\n')[0].split(': ')[1];
    for (const [i, message] of [fixture.first, fixture.next].entries()) {
      if (m18 && fixture.sourceEvent === 'replace') await sources.approve(i ? 'current' : 'old');
      if (m18 && i && fixture.sourceEvent === 'conflict') await sources.approve('disputed');
      const stats = metrics();
      if (i) {
        await page.close();
        page = await context.newPage();
        page.setDefaultTimeout(15000);
        attach(page);
        await step(stats, () => page.goto(origin + '/advice/'), 'wait');
      }
      const click = name => step(stats, () => page.getByRole('button', { name, exact: true }).click());
      await click('Thư khách');
      if (i) await click(title);
      const intake = page.getByRole('textbox', { name: i ? 'Nội dung thư mới' : 'Nội dung email khách', exact: true });
      await step(stats, () => intake.fill(message));
      assert.ok(await page.locator('.email-scope-summary').isVisible());
      if (m18 && ((fixture.id === 'T02' && i) || fixture.id === 'T03')) {
        await step(stats, () => page.locator('.email-scope-details summary').click());
        await step(stats, () => page.getByLabel('Mã đối tác đang xử lý hồ sơ này').fill('partner-alpha'));
      }
      await click(i ? 'Cập nhật theo thư mới' : 'Soạn theo nguồn');
      const version = page.getByLabel('Phiên bản', { exact: true });
      try { await step(stats, () => page.waitForFunction(expected =>
        document.querySelector('#email-workspace select[aria-label="Phiên bản"]')?.value === expected, String(i + 1)), 'wait'); }
      catch (error) {
        console.log(fixture.id, i + 1, await page.locator('#email-workspace').innerText());
        throw error;
      }
      assert.equal(await version.inputValue(), String(i + 1));
      const review = page.locator('.email-review');
      if (m18) {
        const ids = await review.locator('.email-section').evaluateAll(cards => cards.map(card => card.dataset.field));
        const pending = await review.locator('.email-section-pending').evaluateAll(cards => cards.map(card => card.dataset.field));
        assert.deepEqual(ids, fixture.expected[i], fixture.id);
        assert.deepEqual(pending, fixture.pending[i], fixture.id);
        if (fixture.id === 'T02' && !i) assert.equal(await review.locator('[data-source-id="' + sources.ids.get('old') + '"]').count(), 1);
        if (fixture.id === 'T02' && i) {
          assert.match(await review.locator('[data-field="poa"] textarea').inputValue(), /Đối tác A/);
          assert.equal(await review.locator('[data-source-id="' + sources.ids.get('current') + '"]').count(), 1);
          assert.equal(await review.locator('[data-source-id="' + sources.ids.get('old') + '"]').count(), 1);
        }
        if (fixture.id === 'T03' && i) {
          assert.match(await review.locator('[data-field="poa"] textarea').inputValue(), /hướng dẫn trong kho khác nhau/);
          assert.equal(await review.locator('[data-source-id="' + sources.ids.get('disputed') + '"]').count(), 1);
        }
      }
      if (i) {
        const unchanged = (await review.getByRole('button', { name: 'Bỏ duyệt', exact: true }).count());
        if (!m18) assert.equal(unchanged, fixture.expected.length - fixture.changes.length, fixture.id);
        await version.selectOption('1');
        assert.equal(await review.getByRole('button', { name: 'Sao chép bản trả lời', exact: true }).count(), 0);
        await version.selectOption('2');
      }
      const copy = review.getByRole('button', { name: 'Sao chép bản trả lời', exact: true });
      if (await copy.count()) assert.equal(await copy.isEnabled(), false);
      const outputs = {};
      async function capture(audience, control) {
        const fields = await review.locator(audience === 'partner' ? '.email-section-pending textarea' : '.email-section:not(.email-section-pending) textarea')
          .evaluateAll(editors => editors.map(editor => editor.value.trim()));
        await step(stats, () => control.click());
        await step(stats, () => page.waitForFunction(expected =>
          navigator.clipboard.readText().then(value => expected.every(text => value.includes(text))), fields), 'wait');
        await page.getByText('Đã sao chép bản ' + (i + 1), { exact: true }).waitFor();
        outputs[audience] = await page.evaluate(() => navigator.clipboard.readText());
        assert.ok(fields.every(text => outputs[audience].includes(text)), fixture.id + ' ' + audience);
      }
      const todo = await review.getByRole('button', { name: 'Duyệt mục', exact: true }).all();
      for (let n = 0; n < todo.length; n++) {
        const approve = review.getByRole('button', { name: 'Duyệt mục', exact: true }).first();
        const section = review.locator('.email-section').filter({ has: page.getByRole('button', { name: 'Duyệt mục', exact: true }) }).first();
        for (const reference of await section.locator('.email-reference').all()) {
          assert.ok((await reference.locator('blockquote').innerText()).trim());
        }
        if (n === 0) {
          const editor = section.getByRole('textbox');
          await step(stats, async () => editor.fill((await editor.inputValue()) + '\nVui lòng đối chiếu dữ kiện trước khi thực hiện.'));
        }
        const combined = section.getByRole('button', { name: /^Duyệt mục và sao chép/ });
        if (n === todo.length - 1) {
          assert.equal(await combined.count(), 1);
          const field = await section.getAttribute('data-field');
          await capture(await section.evaluate(card => card.classList.contains('email-section-pending')) ? 'partner' : 'client', combined);
          assert.equal(await review.locator('[data-field="' + field + '"]').getByRole('button', { name: 'Bỏ duyệt', exact: true }).count(), 1);
        } else {
          assert.equal(await combined.count(), 0);
          await step(stats, () => approve.click());
        }
      }
      for (const [audience, name] of [['client','Sao chép bản trả lời'],['partner','Sao chép thư xác nhận']]) {
        const control = review.getByRole('button', { name, exact: true });
        if (outputs[audience] || !await control.count()) continue;
        await capture(audience, control);
      }
      if (!screenshot && i && fixture.id === (m18 ? 'T03' : 'TH02')) {
        const close = page.getByRole('button', { name: 'Đóng căn cứ', exact: true });
        if (await close.isVisible()) await close.click();
        await page.locator('#email-workspace h2').scrollIntoViewIfNeeded();
        await page.screenshot({ path: directory + '/chatbot-review.png' });
        screenshot = true;
      }
      const sections = await review.locator('.email-section').evaluateAll(cards => cards.map(card => ({
        id: card.dataset.field, text: card.querySelector('textarea').value,
        pending: card.classList.contains('email-section-pending'), ids: [...card.querySelectorAll('[data-source-id]')].map(node => node.dataset.sourceId),
      })));
      rows.push({ case: fixture.id, session: i + 1, arm: 'chatbot', ...stats, outputs, sections });
    }
  }
  if (!m18) {
    const followUp = page.getByRole('textbox', { name: 'Nội dung thư mới', exact: true });
    await followUp.fill('Đăng ký nhãn hiệu Việt Nam cần biểu mẫu gì?');
    assert.equal(await page.getByRole('button', { name: 'Cập nhật theo thư mới' }).isEnabled(), false);
    await followUp.fill(emailCases.at(-1).next);
    assert.match(await page.locator('.email-scope-summary').innerText(), /đã có trong cuộc trao đổi/);
    assert.equal(await page.getByRole('button', { name: 'Cập nhật theo thư mới' }).isEnabled(), false);
    const savedSurcharge = page.locator('.email-section[data-field="late-fee"]');
    const surchargeDraft = savedSurcharge.getByRole('textbox');
    const amended = await surchargeDraft.inputValue() + '\nĐã rà cùng khách.';
    await surchargeDraft.fill(amended);
    await savedSurcharge.getByRole('button', { name: 'Duyệt mục', exact: true }).click();
    await followUp.fill('Xin đối chiếu lại mức phí cơ quan cho năm thứ 7.');
    await page.getByRole('button', { name: 'Cập nhật theo thư mới' }).click();
    await page.waitForFunction(() => document.querySelector('#email-workspace select[aria-label="Phiên bản"]')?.value === '3');
    assert.equal(await surchargeDraft.inputValue(), amended);
    assert.equal(await savedSurcharge.getByRole('button', { name: 'Bỏ duyệt', exact: true }).count(), 1);
    await page.getByRole('button', { name: 'Danh sách thư', exact: true }).click();
    await page.getByRole('textbox', { name: 'Nội dung email khách', exact: true }).fill('Please send the checklist.');
    assert.equal(await page.getByRole('button', { name: 'Soạn theo nguồn', exact: true }).isEnabled(), false);
    await page.getByRole('combobox', { name: 'Thủ tục', exact: true }).selectOption('vn-renewal');
    assert.ok(await page.getByRole('button', { name: 'Soạn theo nguồn', exact: true }).isEnabled());
  } else {
    const pilot = page.getByRole('button', { name: 'Đo thời gian', exact: true });
    await pilot.click();
    const desk = page.locator('#daily-pilot');
    await desk.getByRole('button', { name: 'Bắt đầu đo', exact: true }).click();
    const friction = 'Chỗ vướng trong phiên';
    await desk.getByLabel(friction).fill('Cần tìm đúng biểu mẫu.');
    await desk.getByRole('button', { name: 'Chờ hệ thống hoặc đối tác' }).click();
    await page.close();
    page = await context.newPage();
    attach(page);
    await page.goto(origin + '/advice/');
    const reopened = page.locator('#daily-pilot');
    await page.getByRole('button', { name: 'Đo thời gian', exact: true }).click();
    assert.match(await reopened.innerText(), /Đang đo chờ/);
    assert.equal(await reopened.getByLabel(friction).inputValue(), 'Cần tìm đúng biểu mẫu.');
    await reopened.getByRole('button', { name: 'Bắt đầu phiên 2' }).click();
    assert.equal(await reopened.getByLabel(friction).inputValue(), '');
    await reopened.getByLabel(friction).fill('Cần đối chiếu ngày.');
    await reopened.getByRole('button', { name: 'Tạm dừng' }).click();
    await reopened.getByLabel('Thư khách đã duyệt').fill('Thư dùng để kiểm xuất phiếu.');
    await reopened.getByLabel('Mã đoạn, ngày hoặc vị trí nguồn để người chấm mở').fill('Mẫu 010-Kor');
    await reopened.getByRole('button', { name: 'Lưu kết quả ca' }).click();
    assert.match(await reopened.innerText(), /1\/24 lượt đối chứng đã lưu/);
    assert.equal(await reopened.getByLabel('Cách làm', { exact: true }).inputValue(), 'current');
    await reopened.getByText(/^Nhật ký 10 ngày/).click();
    await reopened.getByLabel('Tổng thư đủ điều kiện').fill('2');
    await reopened.getByLabel('Đã chọn chatbot').fill('1');
    await reopened.getByLabel('Lý do bỏ qua hoặc quay về').fill('Ca còn lại dùng cách hiện tại.');
    await reopened.getByRole('button', { name: 'Lưu nhật ký ngày' }).click();
    assert.match(await reopened.innerText(), /1\/10/);
    const [journal] = await Promise.all([page.waitForEvent('download'), reopened.getByRole('button', { name: 'Tải nhật ký điều phối' }).click()]);
    const { entries: [entry] } = JSON.parse(readFileSync(await journal.path(), 'utf8'));
    assert.deepEqual(entry.perSession.map(row => [row.session, row.friction]),
      [[1, 'Cần tìm đúng biểu mẫu.'], [2, 'Cần đối chiếu ngày.']]);
    for (const field of ['activeMs', 'waitMs']) {
      assert.equal(entry[field], entry.perSession.reduce((sum, row) => sum + row[field], 0));
    }
    const [download] = await Promise.all([page.waitForEvent('download'), reopened.getByRole('button', { name: 'Tải bản chấm mù' }).click()]);
    const data = JSON.parse(readFileSync(await download.path(), 'utf8'));
    assert.equal(data.submissions.length, 1);
    for (const field of ['arm', 'activeMs', 'waitMs', 'perSession']) assert.ok(!(field in data.submissions[0]));
    await page.screenshot({ path: directory + '/pilot-operator.png' });
    await page.goto(origin + '/advice/m18-review/');
    data.submissions[0].caseMaterial = { question: 'Câu hỏi mô phỏng', sources: ['Đoạn nguồn mô phỏng'] };
    await page.getByLabel('Phiếu chấm mù JSON').setInputFiles({ name: 'phieu.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(data)) });
    for (const label of ['Đúng câu hỏi, thủ tục và dữ kiện', 'Giữ điều kiện áp dụng và biết dừng khi thiếu căn cứ',
      'Dẫn đúng đoạn và phiên bản nguồn', 'Bản cuối dùng được và đúng người nhận']) await page.getByLabel(label).selectOption('true');
    await page.getByLabel('Có lỗi nghiêm trọng').selectOption('false');
    await page.getByRole('button', { name: 'Lưu điểm' }).click();
    assert.match(await page.locator('#blind-status').innerText(), /1\/1/);
    const [grade] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Tải kết quả chấm' }).click()]);
    assert.equal(JSON.parse(readFileSync(await grade.path(), 'utf8'))[0].code, data.submissions[0].code);
  }
  await context.close();
  assert.deepEqual(errors, []);
  writeFileSync(directory + '/browser.json', JSON.stringify(rows, null, 2) + '\n', { mode: 0o600 });
  console.log('Browser verified', rows.length, 'sessions.');
} finally { await browser.close(); }
