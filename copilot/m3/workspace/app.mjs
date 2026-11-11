import { createPDFIntake } from './pdf.mjs';
import { createResearchUI, m5Request } from './research.mjs';

const $ = id => document.getElementById(id);
const endpoint = '/api/m3/cases';
const sections = {
  findings: 'Yêu cầu làm rõ',
  response: 'Nội dung phản hồi',
  attachments: 'Tài liệu kèm theo'
};
const coreSources = ['notice', 'instructions'];
const intake = $('intake');
const dialog = $('dialog');
const task = $('task');
const smallScreen = matchMedia('(max-width:830px)');
let matter = null;
let cases = [];
let queued = null;
let targets = [];
let extraSources = [];
let sourceKey = null;
let tab = 'doc';
let pane = 'sources';
let compare = true;
let desktopPanel = true;
let mobilePanel = false;
let busy = false;
let fileRole = null;
let context = 0;
let wordEnabled = false;
const pdf = createPDFIntake({ intake, run, message });
const research = createResearchUI({
  node, button, run, showDialog, matter: () => matter, onMode: render,
  async onSave(proof) {
    saveState(await m5Request('cases/' + matter.id + '/research', { version: matter.version, research: proof }));
  },
  onNew(facts) {
    intake.elements.asOf.value = facts.asOf;
    intake.elements.receivedOn.value = facts.receivedOn;
    updateCutover();
    if (typeof facts.pendingAtCutover === 'boolean') intake.elements.pending.value = facts.pendingAtCutover ? 'yes' : 'no';
  },
  async onTemplate() {
    if (matter) saveState(await (await request('/' + matter.id)).json());
  }
});

function node(tag, text, className) {
  const item = document.createElement(tag);
  if (text !== undefined) item.textContent = text;
  if (className) item.className = className;
  return item;
}

function icon(name) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  const use = document.createElementNS(ns, 'use');
  svg.classList.add('icon');
  svg.setAttribute('aria-hidden', 'true');
  use.setAttribute('href', '#i-' + name);
  svg.append(use);
  return svg;
}

function button(label, action, style = 'quiet small') {
  const item = node('button', label, style);
  item.type = 'button';
  item.addEventListener('click', () => { if (!busy) action(); });
  return item;
}

function message(text = '', error = false) {
  const item = $('status');
  item.textContent = text;
  item.hidden = !text;
  item.toggleAttribute('data-error', error);
}

async function request(path = '', body) {
  const response = await fetch(endpoint + path, body === undefined ? undefined : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.error ?? 'Chưa kết nối được với hồ sơ. Thử lại.');
  }
  return response;
}

async function run(pending, action) {
  if (busy) return;
  busy = true;
  $('workspace').setAttribute('aria-busy', 'true');
  intake.inert = true;
  $('composer').inert = true;
  $('dialog-content').inert = true;
  message(pending);
  try {
    message(await action());
  } catch (error) {
    if (dialog.open) {
      dialog.querySelector('[data-dialog-error]')?.remove();
      const detail = node('p', error.message, 'feedback');
      detail.dataset.dialogError = '';
      detail.dataset.error = '';
      detail.setAttribute('role', 'alert');
      $('dialog-content').prepend(detail);
    }
    message(error.message, true);
  } finally {
    $('workspace').removeAttribute('aria-busy');
    intake.inert = false;
    $('composer').inert = false;
    $('dialog-content').inert = false;
    busy = false;
  }
}

const latestDraft = () => matter?.drafts.at(-1);
const latestRelease = () => matter?.releases.at(-1);
const displayDate = value => value.split('-').reverse().join('/');
const formatTime = value => new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));

function saveState(value) {
  matter = value;
  const { id, reference, title, updated } = value;
  cases = [{ id, reference, title, updated }, ...cases.filter(item => item.id !== id)].slice(0, 100);
  render();
}

async function mutate(action, data) {
  const res = await request('/' + matter.id + '/' + action, { version: matter.version, ...data });
  saveState(await res.json());
}

function showDialog(title, ...nodes) {
  $('dialog-title').textContent = title;
  $('dialog-content').replaceChildren(...nodes);
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
}

function toggleRail(open) {
  $('sidebar').classList.toggle('mobile-open', open);
  $('show-matters').setAttribute('aria-expanded', String(open));
}

function syncPanel() {
  const visible = Boolean(matter) && (smallScreen.matches ? mobilePanel : desktopPanel);
  $('inspector').hidden = !visible;
  $('inspector').classList.toggle('mobile-open', smallScreen.matches && visible);
  $('workspace').classList.toggle('no-inspector', !visible);
  $('show-sources').setAttribute('aria-expanded', String(visible));
}

function showPanel(open) {
  if (smallScreen.matches) mobilePanel = open;
  else desktopPanel = open;
  syncPanel();
}

function switchMatter(value, openNewForm = false) {
  context += 1;
  queued = null;
  pdf.reset(true);
  task.value = '';
  targets = [];
  matter = value;
  research.switchMatter(value, openNewForm);
  tab = 'doc';
  pane = 'sources';
  compare = true;
  mobilePanel = false;
  sourceKey = value?.sources.at(-1)?.id ?? null;
  const lastRun = value?.drafts.findLast(draft => draft.run)?.run;
  extraSources = (lastRun?.selectedSources ?? []).filter(id => !coreSources.includes(id) && value.sources.some(item => item.id === id));
  const url = new URL('/copilot/m3/workspace/', location.origin);
  if (value) url.searchParams.set('case', value.id);
  history.replaceState(null, '', url);
  toggleRail(false);
  if (!value) {
    intake.reset();
    for (const key of coreSources) delete intake.elements[key].dataset.label;
    updateCutover();
  }
  render();
  $('canvas-scroll').scrollTop = 0;
}

function navigate(id) {
  if (busy) return;
  if (id === matter?.id) return toggleRail(false);
  const action = () => run('Đang mở hồ sơ…', async () => {
    switchMatter(id ? await (await request('/' + id)).json() : null, !id);
  });
  const dirty = queued || research.pending() || task.value.trim() || (!matter && [...intake.querySelectorAll('input, textarea')].some(field =>
    field.type === 'checkbox' ? field.checked : field.value));
  if (!dirty) return action();
  showDialog('Chuyển hồ sơ', node('p', 'Ô giao việc hoặc thông tin tiếp nhận còn nội dung chưa lưu.'),
    button('Chuyển và bỏ nội dung chưa lưu', () => { dialog.close(); action(); }, 'primary'));
}

function renderCases() {
  const normalize = value => value.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd');
  const q = normalize($('case-search').value.trim());
  const visible = cases.filter(item => normalize(item.reference + ' ' + item.title).includes(q));
  $('case-total').textContent = String(visible.length);
  $('empty-search').hidden = Boolean(visible.length);
  $('empty-search').textContent = cases.length ? 'Chưa tìm thấy hồ sơ.' : 'Chưa có hồ sơ đã lưu.';
  $('matter-list').replaceChildren(...visible.map(item => {
    const link = button('', () => navigate(item.id), 'matter-item');
    if (item.id === matter?.id) link.setAttribute('aria-current', 'page');
    const glyph = node('span', undefined, 'rail-file');
    glyph.append(icon('case'));
    const label = node('span');
    label.append(node('strong', item.title), node('small', item.reference));
    link.append(glyph, label);
    if (item.id === matter?.id && pendingCount()) link.append(node('span', undefined, 'case-dot'));
    return link;
  }));
}

function updateCutover() {
  const { receivedOn, asOf, pending } = intake.elements;
  const needed = Boolean(receivedOn.value && receivedOn.value < research.cutover && asOf.value >= research.cutover);
  $('cutover').hidden = !needed;
  pending.required = needed;
  if (!needed) pending.value = '';
}

async function create() {
  const values = Object.fromEntries(new FormData(intake));
  const document = pdf.payload();
  const body = {
    reference: values.reference, title: values.title, asOf: values.asOf, receivedOn: values.receivedOn,
    pendingAtCutover: values.pending ? values.pending === 'yes' : null,
    anonymized: values.anonymized === 'on',
    research: research.pending(),
    notice: { label: intake.elements.notice.dataset.label ?? 'Thông báo thẩm định', text: values.notice },
    instructions: { label: intake.elements.instructions.dataset.label ?? 'Chỉ dẫn khách hàng', text: values.instructions }
  };
  const result = document ? await fetch('/api/m4/cases', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, ...document })
  }) : await request('', body);
  if (!result.ok) throw new Error((await result.json()).error ?? 'Chưa lưu được hồ sơ PDF.');
  const value = await result.json();
  switchMatter(value);
  saveState(value);
}

function filePicker(role) {
  fileRole = role;
  $('files').accept = wordEnabled && role === 'notice' ? '.pdf,.txt,.md,application/pdf,text/plain,text/markdown' : '.txt,.md,text/plain,text/markdown';
  $('files').click();
}

function chooseRole(handler) {
  showDialog('Gắn tệp vào hồ sơ mới', node('p', 'Chọn vai trò của tệp trong hồ sơ.'),
    button('Thông báo thẩm định', () => { dialog.close(); handler('notice'); }),
    button('Chỉ dẫn khách hàng', () => { dialog.close(); handler('instructions'); }));
}

function attachSource(item, role) {
  if (role) {
    if (role === 'notice') pdf.reset();
    const field = intake.elements[role];
    field.value = item.text;
    field.dataset.label = item.label;
    message('Đã đọc ' + item.label + '. Kiểm tra nội dung trước khi lưu hồ sơ.');
  } else {
    queued = item;
    renderAttachments();
    message('Đã đọc tệp. Gửi yêu cầu hoặc lưu nguồn vào hồ sơ.');
  }
}

async function receiveFile(file, role) {
  if (busy || !file) return;
  if (/\.pdf$/i.test(file.name)) {
    if (!wordEnabled || matter || (role && role !== 'notice')) return message('PDF dùng ở ô Thông báo thẩm định khi tạo hồ sơ.', true);
    return pdf.open(file);
  }
  const activeContext = context;
  try {
    if (!/\.(txt|md)$/i.test(file.name) || file.name.length > 90 || file.size > 4400) throw new Error();
    const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
    if (!text.trim() || text.length > 1100 || /[\0\uFFFD]/.test(text)) throw new Error();
    if (activeContext !== context || busy) return;
    const item = { label: file.name, text };
    if (matter && queued) {
      showDialog('Đổi nguồn đang chờ', node('p', 'Nguồn “' + queued.label + '” còn chưa lưu.'),
        button('Dùng ' + item.label, () => { dialog.close(); attachSource(item, null); }, 'primary'));
    } else if (matter || role) attachSource(item, role);
    else chooseRole(key => attachSource(item, key));
  } catch {
    if (activeContext === context) message('Chọn tệp TXT hoặc Markdown UTF-8, tối đa 1.100 ký tự.', true);
  }
}

function pasteSource() {
  const form = node('form', undefined, 'source-form');
  const name = node('input');
  name.maxLength = 90;
  name.required = true;
  name.value = 'Chỉ dẫn bổ sung';
  const content = node('textarea');
  content.maxLength = 1100;
  content.required = true;
  const label = node('label', 'Tên nguồn');
  label.append(name);
  const textLabel = node('label', 'Nội dung nguồn');
  textLabel.append(content);
  form.append(label, textLabel, node('button', 'Thêm vào ô giao việc', 'primary'));
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (busy) return;
    if (!name.value.trim() || !content.value.trim()) return content.focus();
    dialog.close();
    attachSource({ label: name.value.trim(), text: content.value }, null);
  });
  showDialog('Dán nội dung nguồn', node('p', queued ? 'Nguồn đang chờ sẽ được thay bằng nội dung này.' : 'Nguồn sẽ gắn với hồ sơ ' + matter.reference + '.'), form);
}

function renderAttachments() {
  const box = $('attached');
  const fields = [];
  if (queued) {
    const chip = node('span', undefined, 'file-chip');
    chip.append(node('span', queued.label + ' · Chưa lưu'), button('Bỏ tệp', () => { queued = null; renderAttachments(); }, ''));
    fields.push(chip, button('Lưu nguồn', () => run('Đang lưu nguồn…', async () => {
      await saveQueued();
      return 'Đã lưu nguồn vào hồ sơ.';
    })));
  }
  if (matter) for (const id of extraSources) {
    const item = matter.sources.find(row => row.id === id);
    if (!item) continue;
    const chip = node('span', undefined, 'file-chip');
    chip.append(node('span', item.label + ' · Nguồn đã chọn'), button('Bỏ chọn', () => {
      extraSources = extraSources.filter(value => value !== id);
      renderAttachments();
    }, ''));
    fields.push(chip);
  }
  box.replaceChildren(...fields);
  box.hidden = !fields.length;
}

async function saveQueued() {
  if (!queued) return;
  const item = queued;
  let stored = matter.sources.find(source => source.text === item.text);
  if (!stored) {
    await mutate('source', item);
    stored = matter.sources.at(-1);
  }
  queued = null;
  if (!coreSources.includes(stored.id) && !extraSources.includes(stored.id) && extraSources.length < 2) {
    extraSources = [...extraSources, stored.id];
  }
  sourceKey = stored.id;
  renderInspector();
  renderAttachments();
}

function checkbox(id, label, checked, group) {
  const row = node('label', undefined, 'scope-check');
  const input = node('input');
  input.type = 'checkbox';
  input.name = group;
  input.value = id;
  input.checked = checked;
  row.append(input, label);
  return row;
}

function scopeDialog(send = false) {
  const draft = latestDraft();
  const form = node('form');
  if (draft) {
    const parts = node('fieldset', undefined, 'scope-panel');
    parts.append(node('legend', 'Phần giao AI sửa'),
      ...Object.entries(sections).map(([key, label]) => checkbox(key, label, targets.includes(key), 'target')));
    form.append(parts);
  }
  const sources = node('fieldset', undefined, 'scope-panel');
  sources.append(node('legend', 'Nguồn bổ sung, tối đa hai'),
    ...matter.sources.slice(2).map(item => checkbox(item.id, item.label, extraSources.includes(item.id), 'source')));
  if (matter.sources.length > 2) form.append(sources);
  form.append(node('button', send ? 'Gửi yêu cầu' : 'Áp dụng', 'primary'));
  const hint = node('p');
  hint.setAttribute('role', 'status');
  form.append(hint);
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(form);
    if (data.getAll('source').length > 2) return void (hint.textContent = 'Chọn tối đa hai nguồn bổ sung.');
    if (send && draft && !data.getAll('target').length) return void (hint.textContent = 'Chọn ít nhất một phần cần sửa.');
    targets = data.getAll('target');
    extraSources = data.getAll('source');
    dialog.close();
    renderComposer();
    if (send) sendTask();
  });
  showDialog('Phạm vi giao việc', node('p', 'Thông báo và chỉ dẫn ban đầu luôn đi kèm yêu cầu.'), form);
}

function sendTask() {
  if (busy) return;
  const instruction = task.value.trim();
  const draft = latestDraft();
  if (!matter && !intake.reportValidity()) return;
  if (draft && !instruction && !queued) return message('Nhập yêu cầu sửa hoặc thêm nguồn mới.', true);
  if (draft && instruction && !targets.length) return scopeDialog(true);
  if (queued && instruction && extraSources.length === 2 && !extraSources.some(id => matter.sources.find(item => item.id === id)?.text === queued.text)) {
    return message('Đang dùng hai nguồn bổ sung. Bỏ chọn một nguồn để dùng tệp mới.', true);
  }
  return run('Đang xử lý yêu cầu…', async () => {
    if (!matter) {
      await create();
      task.value = instruction;
    }
    const hadSource = Boolean(queued);
    await saveQueued();
    if (draft && !instruction && hadSource) return 'Đã lưu nguồn mới. Giao việc khi sẵn sàng.';
    message('Mô hình đang soạn từ các nguồn đã chọn…');
    await mutate('propose', { sources: [...coreSources, ...extraSources], targets, instruction: instruction || null });
    task.value = '';
    targets = [];
    tab = 'doc';
    render();
    $('canvas-scroll').scrollTop = 0;
    return 'Đã lưu bản nháp ' + latestDraft().number + '. Rà soát từng phần trước khi duyệt.';
  });
}

function renderComposer() {
  const scope = $('task-scope');
  scope.hidden = !matter || (!latestDraft() && matter.sources.length <= 2);
  scope.textContent = targets.length ? 'Sửa ' + targets.length + ' phần' : 'Phạm vi và nguồn';
  $('paste').hidden = !matter;
  renderAttachments();
}

function changes(key, draft = latestDraft()) {
  if (!draft) return false;
  const approved = matter.approved[key];
  const current = draft.sections[key];
  return !approved || current.text !== approved.text || JSON.stringify(current.sources) !== JSON.stringify(approved.sources);
}

const pendingCount = () => Object.keys(sections).filter(key => changes(key)).length;

function diff(oldText, newText) {
  const oldTokens = oldText.match(/\s+|[^\s]+/gu) ?? [];
  const newTokens = newText.match(/\s+|[^\s]+/gu) ?? [];
  const limit = Math.min(oldTokens.length, newTokens.length);
  let prefix = 0;
  while (prefix < limit && oldTokens[prefix] === newTokens[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < limit - prefix && oldTokens.at(-1 - suffix) === newTokens.at(-1 - suffix)) suffix += 1;
  return [oldTokens, newTokens].map((tokens, index) => {
    const row = node('p', undefined, index ? 'diff-new' : 'diff-old');
    const text = node('em');
    text.append(tokens.slice(0, prefix).join(''), node('mark', tokens.slice(prefix, tokens.length - suffix).join('')),
      tokens.slice(tokens.length - suffix).join(''));
    row.append(node('span', index ? '+' : '−'), text);
    return row;
  });
}

function editSection(key) {
  const form = node('form');
  const field = node('textarea');
  field.rows = 6;
  field.required = true;
  field.maxLength = 850;
  field.value = latestDraft().sections[key].text;
  const label = node('label', sections[key]);
  label.append(field);
  const sources = node('fieldset');
  sources.append(node('legend', 'Nguồn của phần sửa'));
  const choices = matter.sources.map(item => {
    const input = node('input');
    input.type = 'checkbox';
    input.value = item.id;
    input.checked = latestDraft().sections[key].sources.includes(item.id);
    const option = node('label', undefined, 'check');
    option.append(input, document.createTextNode(item.label));
    sources.append(option);
    return input;
  });
  form.append(label, sources, node('button', 'Lưu vào bản nháp', 'primary'));
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!field.value.trim()) return;
    run('Đang lưu phần sửa…', async () => {
      await mutate('edit', { edits: { [key]: field.value }, sources: { [key]: choices.filter(item => item.checked).map(item => item.value) } });
      dialog.close();
      return 'Đã lưu bản nháp ' + latestDraft().number + ' để rà soát.';
    });
  });
  showDialog('Sửa nội dung', form);
}

function decide(key, action) {
  const approving = action === 'approve';
  return run(approving ? 'Đang duyệt phần đã chọn…' : 'Đang giữ bản đã duyệt…', async () => {
    const before = latestRelease()?.number;
    await mutate(action, { targets: [key] });
    const after = latestRelease()?.number;
    if (!approving) return 'Đã đưa phần này về nội dung đã duyệt.';
    return before !== after ? 'Đã lưu bản duyệt ' + after + '. Các phần khác giữ nội dung đã duyệt.' : 'Đã duyệt phần này. Duyệt đủ các phần để tạo bản xuất.';
  });
}

function renderDocument() {
  const draft = latestDraft();
  const box = $('clauses');
  $('draft-caption').textContent = draft ? 'Bản nháp ' + draft.number + ' · ' + (pendingCount() ? 'Có phần cần rà soát' : 'Đã rà soát') : 'Chưa có bản nháp';
  $('view-mode').hidden = !draft || tab !== 'doc';
  $('view-mode').setAttribute('aria-pressed', String(compare));
  $('view-mode').querySelector('span').textContent = compare ? 'So sánh với bản đã duyệt' : 'Xem phần thay đổi';
  if (!draft) {
    box.replaceChildren(node('p', 'Giao việc ở ô bên dưới để soạn bản nháp từ thông báo và chỉ dẫn của hồ sơ.', 'empty-document'));
    return;
  }
  box.replaceChildren(...Object.entries(sections).map(([key, title], index) => {
    const section = node('section', undefined, 'clause' + (key === 'response' && changes(key) ? ' active' : ''));
    section.dataset.section = key;
    const part = draft.sections[key];
    const approved = matter.approved[key];
    const changed = changes(key);
    const missing = part.text.includes('[Luật sư xác nhận]');
    const head = node('div', undefined, 'clause-head');
    head.append(node('span', String(index + 1).padStart(2, '0'), 'section-no'), node('h3', title),
      node('span', missing ? 'Cần xác nhận' : changed ? 'Chờ duyệt' : 'Đã duyệt', 'state ' + (changed ? 'pending' : 'approved')));
    section.append(head);
    if (approved && changed && compare && approved.text !== part.text) section.append(...diff(approved.text, part.text));
    else {
      section.append(node('p', part.text));
      if (approved && changed && compare) section.append(node('p', 'Nguồn liên kết đã thay đổi.', 'draft-caption'));
    }
    const controls = node('div', undefined, 'clause-actions');
    const references = node('div', undefined, 'references');
    for (const id of part.sources) {
      const source = matter.sources.find(item => item.id === id);
      if (!source) continue;
      const link = button('', () => openSource(id), 'reference');
      link.append(node('span', sourceIndex(id)), source.label, icon('next'));
      references.append(link);
    }
    const actions = node('div');
    actions.append(button('Sửa tay', () => editSection(key)), button('Giao AI sửa', () => {
      targets = [key];
      renderComposer();
      task.focus();
    }));
    if (changed && approved) actions.append(button('Giữ bản cũ', () => decide(key, 'keep')));
    if (changed && !missing && research.canApprove) actions.append(button('Duyệt phần này', () => decide(key, 'approve'), 'primary small'));
    controls.append(references, actions);
    section.append(controls);
    return section;
  }));
}

function sourceIndex(id) {
  return String(matter.sources.findIndex(item => item.id === id) + 1).padStart(2, '0');
}

function openSource(id) {
  sourceKey = id;
  pane = 'sources';
  renderInspector();
  showPanel(true);
}

function renderInspector() {
  const sources = $('sources-pane');
  const list = node('div', undefined, 'source-list');
  sources.replaceChildren(node('p', 'Nguồn của hồ sơ', 'inspector-label'), list);
  const select = (id, label, detail, number) => {
    const item = button('', () => openSource(id), 'source' + (sourceKey === id ? ' selected' : ''));
    if (sourceKey === id) item.setAttribute('aria-current', 'true');
    const copy = node('span');
    copy.append(node('strong', label), node('small', detail));
    item.append(node('span', number, 'source-index'), copy, icon('next'));
    return item;
  };
  for (const item of matter.sources) {
    const role = item.id === 'notice' ? 'Thông báo thẩm định' : item.id === 'instructions' ? 'Chỉ dẫn khách hàng' : 'Nguồn bổ sung';
    list.append(select(item.id, item.label, role, sourceIndex(item.id)));
    if (sourceKey === item.id) {
      const excerpt = node('div', undefined, 'source-excerpt');
      excerpt.append(node('p', item.sha256.slice(0, 16) + '…', 'excerpt-meta'), node('blockquote', item.text));
      if (item.id === 'notice' && matter.document) {
        const pdfUrl = '/api/m4/cases/' + matter.id + '/notice.pdf#page=';
        for (const anchor of matter.document.anchors) {
          const link = node('a', 'Trang ' + anchor.page + ' · ' + (anchor.mode === 'manual' ? 'Đoạn nhập tay' : 'Đoạn trích'));
          link.href = pdfUrl + anchor.page;
          link.target = '_blank';
          link.rel = 'noopener';
          excerpt.append(link, node('br'));
        }
        for (const [key, value] of Object.entries(matter.document.fields)) {
          if (!value.value) continue;
          const labels = { title: 'Nhãn hiệu', receivedOn: 'Ngày tiếp nhận', application: 'Số đơn', noticeNumber: 'Số thông báo', noticeDate: 'Ngày thông báo', deadline: 'Hạn phản hồi ghi trên thông báo' };
          const detail = node('p', labels[key] + ' · ' + value.value + ' · ' + (value.page ? 'Trang ' + value.page : 'Xác nhận tay'));
          excerpt.append(detail);
        }
      }
      list.append(excerpt);
    }
  }
  const law = node('div', undefined, 'sot');
  law.append(node('p', 'Căn cứ pháp lý', 'inspector-label'));
  for (const [index, item] of matter.basis.citations.entries()) {
    const id = 'law-' + item.id;
    law.append(select(id, item.locator, item.document, String(matter.sources.length + index + 1).padStart(2, '0')));
    if (sourceKey === id) {
      const excerpt = node('div', undefined, 'source-excerpt');
      const link = node('a', 'Mở PDF tại trang ' + item.page);
      link.href = item.snapshotUrl;
      link.target = '_blank';
      link.rel = 'noopener';
      excerpt.append(node('p', item.document + ' · Trang PDF ' + item.page), link);
      law.append(excerpt);
    }
  }
  const stamp = node('p', undefined, 'sot-caption');
  stamp.append(icon('lock'), 'SOT ứng viên · Ngày áp dụng ' + displayDate(matter.basis.applicableOn));
  law.append(stamp);
  sources.append(law);
  $('source-count').textContent = matter.sources.length + matter.basis.citations.length;
  $('version-count').textContent = matter.releases.length;
  const versions = $('versions-pane');
  versions.replaceChildren(node('p', 'Bản duyệt có thể tải', 'inspector-label'));
  if (!matter.releases.length) versions.append(node('p', 'Duyệt đủ ba phần để tạo bản xuất.'));
  for (const release of [...matter.releases].reverse()) {
    const row = node('article', undefined, 'version-row');
    row.append(node('strong', 'Bản duyệt ' + release.number), node('p', formatTime(release.at)),
      button('Xem bản duyệt ' + release.number, () => preview(release)));
    versions.append(row);
  }
  for (const key of ['sources', 'versions']) {
    $(key + '-pane').hidden = pane !== key;
    $('tab-' + key).setAttribute('aria-pressed', String(pane === key));
  }
}

function preview(release) {
  const id = matter.id;
  const name = matter.reference.replaceAll('/', '-');
  const rows = Object.keys(sections).map(key => {
    const section = release.sections[key];
    const row = node('article');
    const title = key === 'findings' ? 'Nội dung được yêu cầu làm rõ' : sections[key];
    row.append(node('h3', title + ' · Nháp ' + section.draft), node('p', section.text));
    return row;
  });
  const evidence = node('article');
  evidence.append(node('h3', 'Căn cứ đối chiếu'),
    ...release.basis.citations.map(item => node('p', item.locator + ' · ' + item.document + ' · trang ' + item.page)));
  if (release.research) evidence.append(node('p', release.research.template.title + ' · Bản ' +
    release.research.template.version), button('Xem căn cứ của bản duyệt', () => research.preview(release.research)));
  const download = word => button(word ? 'Tải Word bản ' + release.number : 'Tải bản duyệt ' + release.number, () => run('Đang tải bản đã duyệt…', async () => {
    const response = word ? await fetch('/api/m4/cases/' + id + '/word/' + release.number + '/daitin-v2')
      : await request('/' + id + '/release/' + release.number);
    if (!response.ok) throw new Error((await response.json()).error ?? 'Chưa tải được bản Word.');
    const bytes = await response.arrayBuffer();
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
    const expected = word ? response.headers.get('X-Artifact-SHA256') : release.sha256;
    if (digest !== expected) throw new Error('Tệp xuất chưa khớp bản duyệt. Hãy mở lại hồ sơ.');
    const url = URL.createObjectURL(new Blob([bytes], { type: response.headers.get('Content-Type') }));
    const anchor = node('a');
    anchor.href = url;
    anchor.download = name + '-ban-duyet-' + release.number + (word ? '-daitin.docx' : '.md');
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    dialog.close();
    return 'Đã tải bản duyệt ' + release.number + '.';
  }), word || !wordEnabled ? 'primary' : 'quiet');
  const actions = node('div', undefined, 'dialog-controls');
  if (wordEnabled) actions.append(download(true));
  actions.append(download(false));
  showDialog('Bản duyệt ' + release.number, node('p', matter.reference + ' · Bản duyệt nội bộ'),
    ...rows, evidence, node('p', 'SHA-256 bản Markdown ' + release.sha256, 'file-fingerprint'), actions);
}

function showTab(next) {
  tab = next;
  $('paper').hidden = tab !== 'doc';
  $('activity').hidden = tab !== 'activity';
  $('view-mode').hidden = tab !== 'doc' || !latestDraft();
  for (const key of ['doc', 'activity']) $('tab-' + key).setAttribute('aria-pressed', String(tab === key));
  if (tab !== 'activity') return;
  const types = { 'model-draft': 'AI soạn bản nháp', 'model-revision': 'AI đề xuất sửa', manual: 'Lưu sửa tay', 'keep-approved': 'Giữ nội dung đã duyệt' };
  const entries = [
    ...matter.drafts.map(item => ({ at: item.at, title: (types[item.type] ?? 'Lưu') + ' · Nháp ' + item.number })),
    ...matter.releases.map(item => ({ at: item.at, title: 'Lưu bản duyệt ' + item.number }))
  ].sort((left, right) => right.at.localeCompare(left.at));
  const list = node('ol');
  for (const item of entries) {
    const row = node('li');
    row.append(node('time', formatTime(item.at)), node('p', item.title));
    list.append(row);
  }
  $('activity').replaceChildren(node('h2', 'Hoạt động đã lưu'), entries.length ? list : node('p', 'Chưa có bản nháp hoặc bản duyệt.'));
}

function render() {
  renderCases();
  const active = Boolean(matter);
  intake.hidden = active || research.asking;
  $('work').hidden = !active || research.asking;
  $('crumb').textContent = matter?.reference ?? (research.asking ? 'Tra cứu' : 'Hồ sơ mới');
  $('composer-case').textContent = matter?.reference ?? 'hồ sơ chưa lưu';
  $('matter-name').textContent = research.asking ? 'Hỏi pháp lý' : matter?.title ?? 'Hồ sơ mới';
  $('matter-meta').hidden = !active;
  $('matter-status').hidden = !active || research.asking;
  $('workspace-context').textContent = research.asking ? 'Tra cứu căn cứ và mẫu' : 'Phản hồi thẩm định';
  $('save-indicator').hidden = !active;
  $('show-sources').hidden = !active;
  $('release-preview').hidden = !latestRelease();
  $('workspace').classList.toggle('case-empty', !active);
  task.placeholder = research.asking ? 'Ví dụ: gia hạn nhãn hiệu dùng biểu mẫu nào?' :
    latestDraft() ? 'Ví dụ: cập nhật phản hồi theo chỉ dẫn mới…' : 'Ví dụ: soạn phản hồi theo thông báo và chỉ dẫn khách hàng…';
  syncPanel();
  renderComposer();
  research.render();
  if (!active) return;
  $('matter-meta').textContent = 'Ngày tiếp nhận ' + displayDate(matter.facts.receivedOn) + '  ·  Ngày đối chiếu ' + displayDate(matter.facts.asOf) +
    (matter.demo ? ' · Hồ sơ mô phỏng' : '');
  const count = pendingCount();
  $('matter-status').textContent = !latestDraft() ? 'Đã lưu nguồn' : count ? 'Chờ duyệt ' + count + ' phần' : 'Đã rà soát các phần';
  $('matter-status').classList.toggle('attention', count > 0);
  $('release-label').textContent = latestRelease() ? 'Bản duyệt ' + latestRelease().number : '';
  renderDocument();
  renderInspector();
  showTab(tab);
}

$('new-matter').addEventListener('click', () => navigate(null));
$('sign-out').addEventListener('click', () => run('Đang đăng xuất…', async () => {
  const response = await fetch('/api/m5/session/logout', { method: 'POST' });
  if (!response.ok) throw new Error('Chưa đăng xuất được. Thử lại.');
  location.reload();
}));
$('case-search').addEventListener('input', renderCases);
$('show-matters').addEventListener('click', () => toggleRail(!$('sidebar').classList.contains('mobile-open')));
$('show-sources').addEventListener('click', () => showPanel(!(smallScreen.matches ? mobilePanel : desktopPanel)));
$('close-sources').addEventListener('click', () => showPanel(false));
smallScreen.addEventListener('change', syncPanel);
$('tab-doc').addEventListener('click', () => showTab('doc'));
$('tab-activity').addEventListener('click', () => showTab('activity'));
for (const key of ['sources', 'versions']) $('tab-' + key).addEventListener('click', () => { pane = key; renderInspector(); });
$('view-mode').addEventListener('click', () => { compare = !compare; renderDocument(); });
$('release-preview').addEventListener('click', () => { if (!busy) preview(latestRelease()); });
$('task-scope').addEventListener('click', () => { if (!busy) scopeDialog(); });
$('paste').addEventListener('click', () => { if (!busy) pasteSource(); });
$('task-example').addEventListener('click', () => {
  if (busy) return;
  if (research.asking) return research.preset();
  if (task.value.trim()) return task.focus();
  task.value = latestDraft() ? 'Cập nhật phần phản hồi theo chỉ dẫn đã chọn, giữ nguyên phạm vi các phần khác.'
    : 'Soạn bản phản hồi theo thông báo và chỉ dẫn của khách hàng.';
  if (latestDraft() && !targets.length) targets = ['response'];
  renderComposer();
  task.focus();
});
$('composer').addEventListener('submit', event => { event.preventDefault(); if (research.asking) research.submit(); else sendTask(); });
$('attach').addEventListener('click', () => {
  if (busy) return;
  if (matter) filePicker(null);
  else chooseRole(filePicker);
});
$('files').addEventListener('change', () => {
  receiveFile($('files').files[0], fileRole);
  $('files').value = '';
});
intake.addEventListener('input', event => {
  updateCutover();
  if (coreSources.includes(event.target.name)) delete event.target.dataset.label;
});
intake.addEventListener('submit', event => {
  event.preventDefault();
  const instruction = task.value;
  run('Đang lưu hồ sơ và đối chiếu…', async () => {
    await create();
    task.value = instruction;
    return 'Đã lưu hồ sơ. Có thể giao việc soạn bản nháp.';
  });
});
for (const key of coreSources) intake.querySelector('[data-file=' + key + ']').addEventListener('click', () => {
  if (!busy) filePicker(key);
});
for (const target of [$('composer'), ...intake.querySelectorAll('[data-intake]')]) {
  for (const name of ['dragenter', 'dragover']) target.addEventListener(name, event => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    if (!busy) target.classList.add('drag');
  });
  target.addEventListener('dragleave', event => {
    if (!(event.relatedTarget instanceof Node) || !target.contains(event.relatedTarget)) target.classList.remove('drag');
  });
  target.addEventListener('drop', event => {
    event.preventDefault();
    target.classList.remove('drag');
    if (research.asking) return message('Chọn Làm hồ sơ để gắn tệp.', true);
    if (event.dataTransfer.files.length > 1) return message('Thêm từng tệp để gắn với đúng vai trò trong hồ sơ.', true);
    receiveFile(event.dataTransfer.files[0], target.dataset.intake ?? null);
  });
}
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !dialog.open) {
    if ($('sidebar').classList.contains('mobile-open')) toggleRail(false);
    else if (smallScreen.matches && mobilePanel) showPanel(false);
  }
  if (event.key !== '/' || dialog.open || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
  event.preventDefault();
  if (smallScreen.matches) toggleRail(true);
  $('case-search').focus();
});

await run('Đang tải danh sách hồ sơ…', async () => {
  const [listing, capability, m5] = await Promise.all([request(), fetch('/api/m4/status'), fetch('/api/m5/status')]);
  cases = await listing.json();
  wordEnabled = capability.ok;
  if (wordEnabled) {
    pdf.configureLimits(await capability.clone().json());
    $('notice-file-label').querySelector('span').textContent = 'Chọn PDF hoặc TXT/MD';
    document.querySelector('.env-index').textContent = 'M4';
  }
  if (m5.ok) {
    const account = await m5.json();
    research.enable(account, !new URL(location.href).searchParams.has('case'));
    $('environment-label').textContent = account.web ? 'Pilot trên máy chủ' : 'Pilot cục bộ';
    if (account.model === null) $('pilot-note').textContent = 'AI chưa bật trên máy chủ. Có thể tra cứu, sửa tay và xuất bản đã duyệt.';
    $('sign-out').hidden = false;
  }
  render();
  const id = new URL(location.href).searchParams.get('case');
  if (id) switchMatter(await (await request('/' + encodeURIComponent(id))).json());
});
