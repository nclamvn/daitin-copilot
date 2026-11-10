const baseUrl = '/api/m3/cases';
const sectionNames = {
  findings: 'Nội dung được yêu cầu làm rõ',
  response: 'Nội dung phản hồi',
  attachments: 'Tài liệu kèm theo'
};
const byId = id => document.getElementById(id);
const matterNode = byId('matter');
const newForm = byId('new-form');
const feedback = byId('feedback');
const edits = new Map();
let matter = null;
let cases = [];
let busy = false;

function el(tag, attrs = {}, ...children) {
  const item = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === false || value === null || value === undefined) continue;
    item.setAttribute(name, value === true ? '' : value);
  }
  item.append(...children);
  return item;
}

function button(label, action, className, disabled = false) {
  const item = el('button', { type: 'button', class: className, disabled }, label);
  item.addEventListener('click', action);
  return item;
}

function tell(message = '', error = false) {
  feedback.textContent = message;
  feedback.hidden = !message;
  feedback.toggleAttribute('data-error', error);
}

async function request(path = '', data) {
  const options = data === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
  };
  const response = await fetch(baseUrl + path, options);
  if (!response.ok) throw new Error((await response.json()).error ?? 'Không xử lý được yêu cầu.');
  return response;
}

async function perform(action, pending, success) {
  if (busy) return;
  busy = true;
  byId('main').setAttribute('aria-busy', 'true');
  for (const area of [newForm, matterNode, byId('case-list'), byId('new-case')]) area.inert = true;
  tell(pending);
  try {
    await action();
    tell(success ?? '');
  } catch (error) {
    tell(error.message, true);
  } finally {
    busy = false;
    byId('main').removeAttribute('aria-busy');
    for (const area of [newForm, matterNode, byId('case-list'), byId('new-case')]) area.inert = false;
  }
}

function caseUrl(id) {
  return '/copilot/m3/' + (id ? '?case=' + encodeURIComponent(id) : '');
}

function activate(value, updateUrl = true) {
  edits.clear();
  matter = value;
  if (updateUrl) history.replaceState(null, '', caseUrl(matter?.id));
  render();
}

async function openCase(id, updateUrl = true) {
  if (edits.size) return tell('Lưu hoặc hoàn tác sửa tay trước khi chuyển hồ sơ.', true);
  await perform(async () => activate(await (await request('/' + id)).json(), updateUrl), 'Đang mở hồ sơ…');
}

function renderList() {
  byId('case-list').replaceChildren(...cases.map(item => {
    const link = el('a', { class: 'case-link', href: caseUrl(item.id),
      'aria-current': matter?.id === item.id ? 'page' : null }, item.reference, el('small', {}, item.title));
    link.addEventListener('click', event => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      openCase(item.id);
    });
    return link;
  }));
  if (!cases.length) byId('case-list').append(el('p', { class: 'muted' }, 'Chưa có hồ sơ đã lưu.'));
}

function saveState(value) {
  const { id, reference, title, updated } = value;
  cases = [{ id, reference, title, updated }, ...cases.filter(row => row.id !== id)].slice(0, 100);
  activate(value);
}

function mutate(action, fields, pending, success) {
  if (edits.size && action !== 'edit') return tell('Lưu hoặc hoàn tác sửa tay trước khi tiếp tục.', true);
  return perform(async () => {
    const result = await request('/' + matter.id + '/' + action, { version: matter.version, ...fields });
    saveState(await result.json());
  }, pending, success);
}

async function importFile(input, textarea) {
  const file = input.files[0];
  if (!file) return;
  try {
    if (file.size > 4400 || !/\.(txt|md)$/i.test(file.name) || file.name.length > 90) {
      throw new Error('Chọn tệp .txt hoặc .md UTF-8, tối đa 1.100 ký tự.');
    }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
    if (!text.trim() || text.length > 1100 || text.includes('\0')) throw new Error('Nội dung tệp chưa hợp lệ hoặc quá dài.');
    textarea.value = text;
    textarea.dataset.label = file.name;
    tell('Đã đọc ' + file.name + '. Bấm lưu để gắn nguồn vào hồ sơ.');
  } catch {
    tell('Tệp phải là .txt hoặc .md UTF-8 hợp lệ, tối đa 1.100 ký tự.', true);
  } finally {
    input.value = '';
  }
}

for (const input of newForm.querySelectorAll('[data-file]')) {
  const field = newForm.elements[input.dataset.file];
  input.addEventListener('change', () => importFile(input, field));
  field.addEventListener('input', () => delete field.dataset.label);
}
newForm.addEventListener('input', () => {
  const { receivedOn, asOf, pending } = newForm.elements;
  const show = receivedOn.value && receivedOn.value < '2026-07-01' && asOf.value >= '2026-07-01';
  byId('cutover-field').hidden = !show;
  pending.required = Boolean(show);
  if (!show) pending.value = '';
});
newForm.addEventListener('submit', event => {
  event.preventDefault();
  const fields = Object.fromEntries(new FormData(newForm));
  perform(async () => {
    const value = await (await request('', {
      reference: fields.reference, title: fields.title, receivedOn: fields.receivedOn, asOf: fields.asOf,
      pendingAtCutover: fields.pending ? fields.pending === 'yes' : null,
      anonymized: fields.anonymized === 'on',
      notice: { label: newForm.elements.notice.dataset.label ?? 'Thông báo thẩm định', text: fields.notice },
      instructions: { label: newForm.elements.instructions.dataset.label ?? 'Chỉ dẫn gốc', text: fields.instructions }
    })).json();
    newForm.reset();
    delete newForm.elements.notice.dataset.label;
    delete newForm.elements.instructions.dataset.label;
    byId('cutover-field').hidden = true;
    newForm.elements.pending.required = false;
    saveState(value);
  }, 'Đang lưu hồ sơ…', 'Đã lưu hồ sơ và đối chiếu căn cứ.');
});
byId('new-case').addEventListener('click', () => {
  if (edits.size) return tell('Lưu hoặc hoàn tác sửa tay trước khi chuyển hồ sơ.', true);
  tell();
  activate(null);
  newForm.elements.reference.focus();
});

function sourcePanel(draft) {
  const list = el('div');
  for (const item of matter.sources) {
    list.append(el('details', { class: 'source-row' }, el('summary', {}, item.label),
      el('p', {}, item.text), el('small', { class: 'muted' }, 'SHA-256 ' + item.sha256.slice(0, 16) + '…')));
  }
  const input = el('input', { type: 'file', accept: '.txt,.md,text/plain,text/markdown' });
  const text = el('textarea', { name: 'update', rows: 3, maxlength: 1100, required: true });
  input.addEventListener('change', () => importFile(input, text));
  text.addEventListener('input', () => delete text.dataset.label);
  const form = el('form', {}, el('label', {}, 'Nhập tệp văn bản', input),
    el('label', {}, 'Văn bản bổ sung', text), el('button', {}, 'Lưu nguồn mới'));
  form.addEventListener('submit', event => {
    event.preventDefault();
    mutate('source', { label: text.dataset.label ?? 'Chỉ dẫn bổ sung ' + (matter.sources.length - 1), text: text.value },
      'Đang lưu nguồn…', 'Đã lưu nguồn vào hồ sơ.');
  });
  const add = el('details', { class: 'source-row' }, el('summary', {}, 'Bổ sung nguồn'), form);
  const picked = draft?.run?.selectedSources?.map(id => matter.sources.find(source => source.id === id)?.label).filter(Boolean);
  return el('section', { class: 'sheet' }, el('h2', {}, 'Nguồn hồ sơ'), list, add,
    ...(picked?.length ? [el('p', { class: 'muted' }, 'Đã dùng khi tạo bản này: ' + picked.join(', '))] : []));
}

function proofPanel() {
  return el('section', { class: 'sheet proof' }, el('h2', {}, 'Căn cứ đã đối chiếu'),
    ...matter.basis.citations.map(item => el('a', { href: item.snapshotUrl, target: '_blank', rel: 'noopener' },
      item.locator + ' · ' + item.document + ' · trang ' + item.page)),
    el('p', { class: 'muted' }, 'Ngày áp dụng ' + matter.basis.applicableOn + ' · SOT ' + matter.basis.sot.slice(0, 12)));
}

function releasePanel() {
  const panel = el('section', { class: 'sheet' }, el('h2', {}, 'Bản xuất đã duyệt'));
  if (!matter.releases.length) panel.append(el('p', { class: 'muted' }, 'Duyệt đủ các phần để tạo bản xuất đầu tiên.'));
  for (const release of [...matter.releases].reverse()) {
    const id = matter.id;
    const filename = matter.reference.replaceAll('/', '-') + '-ban-duyet-' + release.number + '.md';
    const download = button('Tải bản ' + release.number, () => perform(async () => {
      const response = await request('/' + id + '/release/' + release.number);
      const url = URL.createObjectURL(await response.blob());
      const anchor = el('a', { href: url, download: filename });
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'Đang mở bản đã duyệt…', 'Đã tải ' + filename + '.'));
    const trace = Object.entries(release.sections).map(([key, value]) => sectionNames[key] + ' / nháp ' + value.draft);
    panel.append(el('div', { class: 'release-row' }, el('strong', {}, 'Bản duyệt ' + release.number),
      el('details', {}, el('summary', {}, 'Dấu vết phê duyệt'),
        el('p', {}, trace.join('\n') + '\nSHA-256 ' + release.sha256)), download));
  }
  return panel;
}

function composer(draft) {
  const form = el('form');
  if (draft) {
    form.append(el('label', {}, 'Yêu cầu sửa',
      el('textarea', { name: 'instruction', rows: 2, maxlength: 400, required: true, placeholder: 'Ví dụ: cập nhật nội dung phản hồi theo chỉ dẫn mới.' })),
      el('fieldset', {}, el('legend', {}, 'Các phần giao AI sửa'),
        ...Object.entries(sectionNames).map(([id, name]) => el('label', { class: 'tick' },
          el('input', { type: 'checkbox', name: 'target', value: id }), name))));
  }
  if (matter.sources.length > 2) {
    form.append(el('fieldset', {}, el('legend', {}, 'Chọn tối đa hai nguồn bổ sung'),
      ...matter.sources.slice(2).map(item => el('label', { class: 'tick' },
        el('input', { type: 'checkbox', name: 'source', value: item.id }), item.label))));
  }
  form.append(el('button', { class: 'primary' }, draft ? 'Tạo đề xuất sửa' : 'Soạn bản nháp'));
  form.addEventListener('submit', event => {
    event.preventDefault();
    const data = new FormData(form);
    mutate('propose', { targets: data.getAll('target'), sources: ['notice', 'instructions', ...data.getAll('source')],
      instruction: data.get('instruction') }, 'Mô hình đang soạn dựa trên nguồn đã chọn…', 'Đã lưu bản nháp mới. Kiểm tra từng phần trước khi duyệt.');
  });
  return el('section', { class: 'sheet composer' }, el('h2', {}, draft ? 'Giao việc sửa bản nháp' : 'Soạn phản hồi'),
    el('p', { class: 'muted' }, 'Thông báo và chỉ dẫn gốc luôn đi cùng yêu cầu.'), form);
}

function draftPanel(draft) {
  const panel = el('section', { class: 'sheet' }, el('div', { class: 'title-row' },
    el('h2', {}, 'Bản nháp ' + draft.number), el('span', { class: 'status-tag' }, 'Lưu trên máy này')));
  const form = el('form');
  const save = button('Lưu sửa tay', () => mutate('edit', { edits: Object.fromEntries(edits) },
    'Đang lưu sửa tay…', 'Đã lưu bản sửa. Chọn từng phần cần duyệt.'), null, true);
  const reset = button('Hoàn tác sửa tay', () => { edits.clear(); render(); }, null, true);
  const approve = el('button', { class: 'primary', disabled: true }, 'Duyệt phần đã chọn');
  const checks = [];
  function controls() {
    save.disabled = reset.disabled = !edits.size;
    approve.disabled = Boolean(edits.size) || !checks.some(check => check.checked && !check.disabled);
  }
  for (const [key, title] of Object.entries(sectionNames)) {
    const current = draft.sections[key];
    const approved = matter.approved[key];
    const changed = !approved || current.text !== approved.text ||
      JSON.stringify(current.sources) !== JSON.stringify(approved.sources);
    const mark = el('span', { class: 'status-tag' + (changed ? ' change' : '') },
      approved ? (changed ? 'Có thay đổi' : 'Đã duyệt') : 'Chưa duyệt');
    const box = el('textarea', { rows: 5, maxlength: 850, 'aria-label': 'Sửa ' + title }, current.text);
    box.addEventListener('input', () => {
      if (box.value === current.text) edits.delete(key);
      else edits.set(key, box.value);
      controls();
    });
    const incomplete = current.text.includes('[Luật sư xác nhận]');
    const select = el('input', { type: 'checkbox', name: 'approve', value: key, disabled: !changed || incomplete });
    select.addEventListener('change', controls);
    checks.push(select);
    const names = current.sources.map(id => matter.sources.find(item => item.id === id)?.label).join(', ');
    const area = el('div', { class: 'section', 'data-section': key }, el('div', { class: 'title-row' },
      el('h3', {}, title), mark), box,
      el('p', { class: 'muted' }, 'Nguồn liên kết: ' + names),
      el('div', { class: 'controls' }, el('label', { class: 'tick' }, select, 'Chọn duyệt ' + title.toLowerCase())));
    if (incomplete) area.append(el('p', { class: 'muted' }, 'Bổ sung phần còn thiếu, rồi lưu trước khi duyệt.'));
    if (approved && changed) {
      area.append(el('details', { open: true }, el('summary', {}, 'So sánh với phần đã duyệt'),
        el('div', { class: 'lanes' },
          el('div', {}, el('strong', {}, 'Đã duyệt / nháp ' + approved.draft), el('p', {}, approved.text)),
          el('div', {}, el('strong', {}, 'Đề xuất đã lưu / nháp ' + draft.number), el('p', {}, current.text)))));
    }
    form.append(area);
  }
  form.append(el('div', { class: 'controls' }, save, reset, approve));
  form.addEventListener('submit', event => {
    event.preventDefault();
    mutate('approve', { targets: new FormData(form).getAll('approve') }, 'Đang lưu quyết định…',
      'Đã duyệt các phần đã chọn. Bản xuất giữ nguyên những phần đã duyệt còn lại.');
  });
  panel.append(form);
  return panel;
}

function render() {
  renderList();
  newForm.hidden = Boolean(matter);
  matterNode.hidden = !matter;
  byId('matter-title').textContent = matter?.title ?? 'Phản hồi thông báo thẩm định';
  byId('matter-meta').textContent = matter ? matter.reference + ' · Đối chiếu ' + matter.facts.asOf
    : 'Lưu thông báo, soạn phản hồi và duyệt nội dung để xuất bản nội bộ.';
  if (!matter) return;
  const draft = matter.drafts.at(-1);
  const editor = el('div', { class: 'editor' });
  if (draft) editor.append(draftPanel(draft));
  editor.append(composer(draft));
  const side = el('aside', { class: 'side', 'aria-label': 'Nguồn và bản duyệt' }, releasePanel(), sourcePanel(draft), proofPanel());
  matterNode.replaceChildren(el('div', { class: 'case-layout' }, editor, side));
}

await perform(async () => {
  cases = await (await request()).json();
  render();
  const id = new URL(location.href).searchParams.get('case');
  if (id) activate(await (await request('/' + encodeURIComponent(id))).json(), false);
}, 'Đang tải danh sách hồ sơ…');
