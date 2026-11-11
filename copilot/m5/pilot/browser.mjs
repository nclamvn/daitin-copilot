import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hash } from '../../m3/workflow.mjs';
import { recorder, reviewDraft, safeAnswer } from './actor.mjs';

const escaped = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const btn = (tab, name) => tab.getByRole('button', { name, exact: true });
const ready = tab => tab.locator('#workspace:not([aria-busy])').waitFor();

async function open(browser, config, record) {
  const start = performance.now();
  const context = await browser.newContext({ baseURL: config.base, httpCredentials: config.credentials, viewport: { width: 1440, height: 960 },
    acceptDownloads: true });
  const tab = await context.newPage();
  tab.setDefaultTimeout(10000);
  const errors = [];
  tab.on('pageerror', error => errors.push(error.message));
  record.setupMs = Math.round(performance.now() - start);
  const step = recorder(record);
  const click = async (name, locator = btn(tab, name)) => {
    await ready(tab);
    return step('gesture', name, () => locator.click());
  };
  const fill = (name, locator, value) => step('gesture', name, () => locator.fill(value), value.length);
  const select = (name, locator, value) => step('gesture', name, () => locator.selectOption(value));
  const check = (name, locator) => step('gesture', name, () => locator.check());
  await step('navigation', 'Mở phiên làm việc mới', () => tab.goto(config.base + '/copilot/m3/workspace/'));
  await ready(tab);
  return { context, tab, errors, step, click, fill, select, check };
}

async function ask(ui, request) {
  const { tab, step, click, fill, select, check } = ui;
  await fill('Nhập câu hỏi', tab.locator('#task'), request.question);
  if (request.asOf) await fill('Chọn ngày đối chiếu', tab.locator('#ask-date'), request.asOf);
  if (request.mode === 'case') {
    await select('Chọn hồ sơ đã tiếp nhận', tab.locator('#ask-context'), 'case');
    await fill('Chọn ngày tiếp nhận', tab.locator('#ask-received'), request.receivedOn ?? '');
    if (typeof request.pendingAtCutover === 'boolean') {
      await select('Xác nhận tình trạng chuyển tiếp', tab.locator('#ask-pending'), request.pendingAtCutover ? 'yes' : 'no');
    }
  }
  await check('Xác nhận dữ liệu mô phỏng', tab.locator('#ask-anonymized'));
  const response = tab.waitForResponse(r => r.url().endsWith('/api/m5/research') && r.request().method() === 'POST');
  await click('Gửi yêu cầu');
  const received = await step('wait', 'Chờ kết quả đối chiếu', () => response);
  if (!received.ok()) throw new Error(await received.text());
  const result = await received.json();
  await ready(tab);
  return result;
}

async function inspectSources(ui, answer) {
  const { context, tab, step, click } = ui;
  const evidence = [...(answer.form ? [answer.form] : []), ...answer.citations];
  for (const [index, citation] of evidence.entries()) {
    const selector = citation === answer.form
      ? tab.getByRole('link', { name: 'Mở đúng phiên bản biểu mẫu', exact: true })
      : tab.getByRole('link', { name: 'Mở đúng trang', exact: true }).nth(index - (answer.form ? 1 : 0));
    assert.equal(await selector.getAttribute('href'), citation.snapshotUrl);
    const popup = context.waitForEvent('page');
    await click('Mở trang căn cứ ' + citation.id, selector);
    const opened = await popup;
    await opened.close().catch(() => {});
    await step('evidence-fetch', 'Kiểm dấu nguồn ' + citation.id, async () => {
      const res = await context.request.get(citation.snapshotUrl.split('#')[0]);
      assert.equal(res.status(), 200);
      assert.equal(hash(await res.body()), citation.sha256);
    });
  }
}

export async function lookupBrowser(browser, entry, config) {
  const record = { status: 'running', interaction: 'browser-replay', humanActiveMs: null };
  const start = performance.now();
  let ui;
  try {
    ui = await open(browser, config, record);
    const answer = await ask(ui, entry.request);
    await inspectSources(ui, answer);
    record.answer = safeAnswer(answer);
    assert.deepEqual(ui.errors, []);
    record.status = 'complete';
  } catch (error) {
    record.status = 'blocked';
    record.error = error.message;
  } finally {
    if (ui) await ui.context.close();
  }
  record.wallMs = Math.round(performance.now() - start);
  return record;
}

export async function matterBrowser(browser, entry, phase, prior, config) {
  const record = { status: 'running', interaction: 'browser-replay', humanActiveMs: null };
  const start = performance.now();
  let ui;
  try {
    ui = await open(browser, config, record);
    const { tab, context, click, fill, check, step } = ui;
    if (phase === 1) {
      const answer = await ask(ui, entry.request);
      if (!answer.proofId) throw new Error('Chưa có căn cứ để soạn.');
      await inspectSources(ui, answer);
      await click('Dùng căn cứ cho hồ sơ mới');
      await fill('Nhập mã hồ sơ', tab.locator('[name=reference]'), entry.reference);
      await fill('Nhập nhãn hiệu', tab.locator('[name=title]'), entry.title);
      await fill('Gắn thông báo', tab.locator('[name=notice]'), entry.notice.text);
      await fill('Gắn chỉ dẫn ban đầu', tab.locator('[name=instructions]'), entry.instructions.text);
      await check('Xác nhận quyền dùng nguồn', tab.locator('[name=anonymized]'));
      await click('Lưu hồ sơ');
      await tab.locator('#research-saved').waitFor();
    } else {
      await fill('Tìm lại mã hồ sơ', tab.locator('#case-search'), entry.reference);
      await click('Mở đúng hồ sơ', tab.getByRole('button', { name: new RegExp(escaped(entry.reference)) }));
      await tab.locator('#research-saved').waitFor();
      await click('Xem căn cứ');
      await tab.getByRole('heading', { name: 'Căn cứ đã lưu', exact: true }).waitFor();
      await click('Đóng cửa sổ');
      await click('Dán nguồn');
      await fill('Đặt tên nguồn bổ sung', tab.getByRole('textbox', { name: 'Tên nguồn', exact: true }), entry.update.label);
      await fill('Gắn chỉ dẫn mới', tab.getByRole('textbox', { name: 'Nội dung nguồn', exact: true }), entry.update.text);
      await click('Thêm vào ô giao việc');
      await click('Chọn phần phản hồi để sửa', tab.locator('[data-section=response]').getByRole('button', { name: 'Giao AI sửa' }));
    }
    const id = new URL(tab.url()).searchParams.get('case');
    assert.ok(id);
    if (phase === 2) assert.equal(id, prior.id);
    const getState = async () => {
      const res = await context.request.get(config.base + '/api/m3/cases/' + id);
      assert.equal(res.status(), 200);
      return res.json();
    };
    const before = await getState();
    if (phase === 2) {
      assert.equal(before.research.proofId, prior.proofId);
      const old = await context.request.get(config.base + '/api/m4/cases/' + id + '/word/1/daitin-v2');
      assert.equal(hash(await old.body()), prior.wordSha256);
    }
    await fill('Nhập yêu cầu soạn hoặc sửa', tab.locator('#task'), phase === 1 ? entry.draft : entry.revise);
    const proposed = tab.waitForResponse(r => r.url().endsWith('/' + id + '/propose') && r.request().method() === 'POST', { timeout: 95000 });
    await click('Gửi yêu cầu');
    const reply = await step('generator', 'Chờ mô hình soạn phần được giao', () => proposed);
    if (!reply.ok()) throw new Error(await reply.text());
    await ready(tab);
    let state = await getState();
    const draft = state.drafts.at(-1);
    record.run = draft.run;
    record.raw = draft.sections;
    record.review = await step('review-policy', 'Rà soát giả lập theo nguồn', () => reviewDraft(entry, draft.sections, phase));
    for (const [key, value] of Object.entries(record.review.edits)) {
      await click('Mở sửa tay ' + key, tab.locator('[data-section=' + key + ']').getByRole('button', { name: 'Sửa tay' }));
      await fill('Sửa nội dung ' + key, tab.getByRole('dialog').getByRole('textbox'), value);
      await click('Lưu vào bản nháp');
    }
    for (const key of phase === 1 ? ['findings', 'response', 'attachments'] : ['response']) {
      await click('Duyệt phần ' + key, tab.locator('[data-section=' + key + ']').getByRole('button', { name: 'Duyệt phần này' }));
    }
    await click('Bản duyệt ' + phase);
    const download = tab.waitForEvent('download');
    await click('Tải Word bản ' + phase);
    const artifact = await step('wait', 'Nhận Word đã duyệt', () => download);
    const path = resolve(config.dir, 'workspace-' + phase + '.docx');
    await artifact.saveAs(path);
    const bytes = readFileSync(path);
    assert.ok(bytes.includes(Buffer.from('word/media/daitin-gray.png')));
    state = await getState();
    const release = state.releases.at(-1);
    assert.equal(release.number, phase);
    assert.equal(release.research.proofId, state.research.proofId);
    if (phase === 2) {
      for (const key of ['findings', 'attachments']) assert.deepEqual(release.sections[key], state.releases[0].sections[key]);
      const old = await context.request.get(config.base + '/api/m4/cases/' + id + '/word/1/daitin-v2');
      assert.equal(hash(await old.body()), prior.wordSha256);
    }
    record.id = id;
    record.proofId = state.research.proofId;
    record.release = release;
    record.wordSha256 = hash(bytes);
    assert.deepEqual(ui.errors, []);
    record.browserErrors = ui.errors;
    if (config.screenshot) await tab.screenshot({ path: resolve(config.dir, 'workspace-' + phase + '.png') });
    record.status = 'complete';
  } catch (error) {
    record.status = 'blocked';
    record.error = error.message;
    if (ui) await ui.tab.screenshot({ path: resolve(config.dir, 'failure-' + phase + '.png') }).catch(() => {});
  } finally {
    if (ui) await ui.context.close();
  }
  record.wallMs = Math.round(performance.now() - start);
  return record;
}
