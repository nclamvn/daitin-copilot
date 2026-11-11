import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hash, ids } from '../../m3/workflow.mjs';
import { brandedWordLayout } from '../word-brand.mjs';
import { simulatedReview } from './simulated-review.mjs';

const rx = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function openWorkspaceBrowser() {
  const { chromium } = createRequire(import.meta.url)(process.env.DAI_TIN_PLAYWRIGHT ?? 'playwright');
  return chromium.launch({ executablePath: process.env.DAI_TIN_CHROME, headless: true });
}

export async function useWorkspace(browser, entry, phase, record, { base, getFile, request, instruction }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 940 }, acceptDownloads: true });
  const tab = await context.newPage();
  const browserErrors = [];
  tab.on('pageerror', error => browserErrors.push(error.message));
  tab.setDefaultTimeout(7000);
  record.actions = [];
  const step = async (name, action) => {
    const t = performance.now();
    try {
      return await action();
    } finally {
      record.actions.push({ name, ms: Math.round(performance.now() - t) });
    }
  };
  const click = (name, locator) => step(name, () => locator.click());
  const button = name => tab.getByRole('button', { name, exact: true });
  const fill = (name, locator, value) => step(name, () => locator.fill(value));
  const check = (name, locator) => step(name, () => locator.check());
  const ready = () => tab.locator('#workspace:not([aria-busy])').waitFor();
  const oracle = entry.oracle;
  const file = name => getFile(entry, name);
  const text = name => readFileSync(file(name), 'utf8');
  let phaseDraft = 1;
  const actor = async (label, selector, filename) => step(label, async () => {
    const handle = await tab.evaluateHandle(({ filename, content }) => {
      const data = new DataTransfer();
      data.items.add(new File([content], filename, { type: 'text/plain' }));
      return data;
    }, { filename, content: text(filename) });
    await tab.locator(selector).dispatchEvent('drop', { dataTransfer: handle });
    await handle.dispose();
  });
  async function expectDraft(number) {
    const expected = tab.getByText(new RegExp('Bản nháp ' + number + ' ·'));
    const failed = tab.locator('#status[data-error]');
    await expected.or(failed).first().waitFor({ timeout: 95000 });
    if (!(await expected.isVisible())) throw new Error(await failed.innerText());
  }
  async function chooseField(value, label, fallback) {
    if (value == null) return;
    const candidate = tab.getByRole('button', { name: new RegExp('^' + rx(value) + ' · Trang \\d+$') }).last();
    if (await candidate.count()) await click('Xác nhận ' + label + ' theo trang', candidate);
    else await fill('Nhập ' + label + ' đã kiểm', fallback, value);
  }
  try {
    await tab.goto(base + '/copilot/m3/workspace/');
    await ready();
    if (phase === 1) {
      await fill('Nhập mã hồ sơ', tab.locator('[name=reference]'), entry.id);
      await fill('Nhập ngày đối chiếu', tab.locator('[name=asOf]'), oracle.case.asOf);
      await check('Xác nhận quyền dùng', tab.locator('[name=anonymized]'));
      await step('Chọn PDF gốc', async () => {
        const [picker] = await Promise.all([tab.waitForEvent('filechooser'), tab.locator('[data-file=notice]').click()]);
        await picker.setFiles(file('thong-bao.pdf'));
      });
      await tab.getByRole('img', { name: /Ảnh trang 1/ }).waitFor();
      await tab.waitForFunction(() => document.querySelector('.pdf-page-view img')?.naturalWidth > 0);
      await chooseField(oracle.case.title, 'tên nhãn hiệu', tab.locator('[name=title]'));
      await chooseField(oracle.case.receivedOn, 'ngày tiếp nhận', tab.locator('[name=receivedOn]'));
      for (const [key, label] of Object.entries({
        application: 'Số đơn', noticeNumber: 'Số thông báo', noticeDate: 'Ngày thông báo', deadline: 'Hạn phản hồi ghi trên thông báo'
      })) await chooseField(oracle[key], label, tab.locator('[aria-label="' + label + '"]'));
      if (oracle.case.pendingAtCutover != null) {
        await step('Xác nhận tình trạng chuyển tiếp', () => tab.locator('[name=pending]').selectOption(oracle.case.pendingAtCutover ? 'yes' : 'no'));
      }
      if (oracle.anchorPage !== 1) {
        await step('Mở đúng trang yêu cầu', () => tab.getByLabel('Trang PDF', { exact: true }).selectOption(String(oracle.anchorPage)));
        await tab.getByRole('img', { name: 'Ảnh trang ' + oracle.anchorPage + ' của thông báo' }).waitFor();
      }
      if (oracle.scanPages.includes(oracle.anchorPage)) {
        await click('Mở nhập tay trang scan', tab.getByText('Nhập đoạn bằng tay theo trang này', { exact: true }));
        await fill('Gõ đoạn nguồn từ ảnh', tab.getByRole('textbox', { name: 'Đoạn nhập tay theo trang' }), oracle.anchorText);
        await click('Xác nhận đoạn nhập tay', button('Lưu đoạn nhập tay'));
      } else {
        await step('Bôi chọn đoạn trên trang', () => tab.getByRole('textbox', { name: 'Văn bản trang PDF' }).evaluate((field, phrase) => {
          const start = field.value.indexOf(phrase);
          if (start < 0) throw new Error('Thiếu đoạn nguồn');
          field.focus();
          field.setSelectionRange(start, start + phrase.length);
        }, oracle.anchorText));
        await click('Dùng đoạn đã chọn', button('Dùng đoạn đã bôi chọn'));
      }
      await actor('Gắn chỉ dẫn gốc', '[data-intake=instructions]', 'chi-dan.txt');
      await tab.waitForFunction(() => document.querySelector('[name=instructions]').value.length > 0);
      await check('Xác nhận dữ kiện PDF', tab.locator('#pdf-confirm'));
      await click('Lưu hồ sơ', button('Lưu hồ sơ'));
      await tab.getByRole('heading', { name: oracle.case.title, exact: true }).waitFor();
      entry.workspace.matter = new URL(tab.url()).searchParams.get('case');
      await click('Giao AI soạn', button('Gửi yêu cầu'));
    } else {
      await click('Mở lại đúng mã', tab.getByRole('button', { name: new RegExp(rx(entry.id)) }));
      await tab.getByRole('heading', { name: oracle.case.title, exact: true }).waitFor();
      const stored = await request('/api/m3/cases/' + entry.workspace.matter);
      assert.equal(stored.releases[0].sha256, entry.workspace[1].markdownHash);
      phaseDraft = stored.drafts.at(-1).number + 1;
      await click('Mở nguồn đã lưu', tab.locator('#sources-pane').getByRole('button', { name: /thong-bao\.pdf/ }));
      const link = tab.getByRole('link', { name: new RegExp('Trang ' + oracle.anchorPage + ' ·') });
      assert.match(await link.getAttribute('href'), new RegExp('#page=' + oracle.anchorPage + '$'));
      await actor('Gắn chỉ dẫn bổ sung', '#composer', 'xac-nhan-moi.txt');
      await tab.getByText('xac-nhan-moi.txt · Chưa lưu', { exact: true }).waitFor();
      await fill('Nhập yêu cầu sửa', tab.locator('#task'), instruction);
      await click('Mở phạm vi sửa', button('Gửi yêu cầu'));
      const scope = tab.getByRole('dialog');
      await check('Chọn sửa phản hồi', scope.getByLabel('Nội dung phản hồi'));
      await check('Chọn sửa tài liệu', scope.getByLabel('Tài liệu kèm theo'));
      await click('Giao AI sửa', scope.getByRole('button', { name: 'Gửi yêu cầu' }));
    }
    await expectDraft(phaseDraft);
    const id = entry.workspace.matter;
    const path = '/api/m3/cases/' + id;
    const matter = await request(path);
    assert.equal(matter.document.anchors[0].text, oracle.anchorText);
    const draft = matter.drafts.at(-1);
    record.run = draft.run;
    record.draft = draft.sections;
    const { issues, edits } = simulatedReview(oracle, draft.sections, phase);
    record.issues = issues;
    let nextDraft = phaseDraft;
    for (const [key, replacement] of Object.entries(edits)) {
      const section = tab.locator('[data-section=' + key + ']');
      await click('Mở sửa tay ' + key, section.getByRole('button', { name: 'Sửa tay' }));
      await fill('Sửa phần ' + key, tab.getByRole('dialog').getByRole('textbox'), replacement);
      await click('Lưu sửa tay ' + key, button('Lưu vào bản nháp'));
      nextDraft += 1;
      await expectDraft(nextDraft);
    }
    for (const key of phase === 1 ? ids : ['response']) {
      await click('Duyệt ' + key, tab.locator('[data-section=' + key + ']').getByRole('button', { name: 'Duyệt phần này' }));
      await ready();
    }
    await click('Mở bản duyệt ' + phase, button('Bản duyệt ' + phase));
    const fileDownload = await step('Tải Word ' + phase, async () => {
      const [download] = await Promise.all([tab.waitForEvent('download'), button('Tải Word bản ' + phase).click()]);
      return download;
    });
    const bytes = readFileSync(await fileDownload.path());
    assert.ok(bytes.includes(Buffer.from('word/media/daitin-gray.png')));
    writeFileSync(resolve(entry.work, 'workspace-' + phase + '.docx'), bytes, { mode: 0o600 });
    const stored = await request(path);
    const release = stored.releases.at(-1);
    assert.equal(release.number, phase);
    if (phase === 2) {
      assert.deepEqual(release.sections.attachments, stored.releases[0].sections.attachments);
      const old = await request('/api/m4/cases/' + id + '/word/1/' + brandedWordLayout, undefined, 'word');
      assert.equal(hash(old), entry.workspace[1].sha);
    }
    record.sha = hash(bytes);
    record.markdownHash = release.sha256;
    assert.deepEqual(browserErrors, []);
  } finally {
    await context.close();
  }
}
