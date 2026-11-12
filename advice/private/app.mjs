const byId = id => document.getElementById(id);
const status = byId('status');
const actions = new Set();
const drafts = new Map();
let catalogue;
let currentDoc;
let currentPlan;
let timer;

function element(tag, text = '', className = '') {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

async function request(path, data) {
  const response = await fetch('/api/advice/private/' + path, data === undefined ? undefined : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'Chưa thực hiện được thao tác.');
  return result;
}

async function run(control, task) {
  if (actions.has(control)) return;
  actions.add(control);
  control.disabled = true;
  status.dataset.error = 'false';
  status.textContent = '';
  try {
    await task();
  } catch (error) {
    status.dataset.error = 'true';
    status.textContent = error.message;
  } finally {
    actions.delete(control);
    control.disabled = false;
  }
}

function button(text, callback, className) {
  const node = element('button', text, className);
  node.type = 'button';
  node.onclick = () => run(node, callback);
  return node;
}

function field(label, input) {
  const container = element('label', label);
  container.append(input);
  return container;
}

function choice(options, name) {
  const select = document.createElement('select');
  select.name = name;
  for (const [key, label] of options) {
    const option = element('option', label);
    option.value = key;
    select.append(option);
  }
  return select;
}

function input(name, type = 'text') {
  const item = document.createElement('input');
  item.name = name;
  item.type = type;
  return item;
}

function formSubmit(form, text, action) {
  const submit = element('button', text, 'primary');
  form.append(submit);
  form.addEventListener('submit', event => {
    event.preventDefault();
    void run(submit, () => action(new FormData(form)));
  });
}

async function refresh() {
  catalogue = await request('library');
  byId('catalogue').textContent = catalogue.docs.length + ' tài liệu · ' + catalogue.approved.length + ' đoạn đã duyệt';
  byId('pilot-create').hidden = !catalogue.reviewer;
  byId('documents').replaceChildren(...catalogue.docs.map(doc => {
    const row = element('div', '', 'file');
    row.append(button(doc.name, () => openDocument(doc.sha)), element('span',
      doc.approved ? doc.approved + ' đoạn đã duyệt' : 'Chờ duyệt', 'meta'));
    return row;
  }));
  byId('pilot-sources').replaceChildren(...catalogue.approved.map(source => {
    const checkbox = input('source', 'checkbox');
    checkbox.value = source.id;
    const label = field(source.title + ' · Đoạn ' + source.paragraph, checkbox);
    label.className = 'check';
    label.prepend(checkbox);
    return label;
  }));
  byId('plans').replaceChildren(...catalogue.pilots.map(plan =>
    button(plan.title + (plan.mode === 'simulation' ? ' · Diễn tập' : ''), () => openPlan(plan.id))));
}

function reviewForm(doc, part) {
  const form = document.createElement('form');
  const options = catalogue.options;
  const labels = ['Quốc gia', 'Loại quyền', 'Thủ tục', 'Nội dung'];
  const suggested = doc.suggestedReview;
  options.labels.forEach((group, i) => {
    const select = choice([['', 'Chọn ' + labels[i].toLowerCase()], ...Object.entries(group)], 'scope' + i);
    select.value = suggested?.scope[i] ?? '';
    form.append(field(labels[i], select));
  });
  const statement = element('textarea');
  statement.name = 'statement';
  statement.rows = 3;
  statement.required = true;
  statement.value = suggested?.statement ?? '';
  const client = element('textarea');
  client.name = 'clientText';
  client.rows = 3;
  const issuer = input('issuer');
  issuer.placeholder = 'vd cuc-shtt, ipos, dai-dien-thai';
  issuer.required = true;
  issuer.value = suggested?.issuer ?? '';
  const confirmed = input('confirmed', 'checkbox');
  confirmed.required = true;
  const check = field('Tôi đã đối chiếu đoạn gốc, phạm vi và nội dung sẽ dùng.', confirmed);
  check.className = 'check';
  check.prepend(confirmed);
  const result = choice([['', 'Chọn kết luận'], ...options.values], 'value');
  result.value = suggested?.value ?? '';
  form.append(field('Kết luận của đoạn', result),
    field('Mã đơn vị xác nhận', issuer), field('Ngày xác nhận (nếu có)', input('date', 'date')),
    field('Mã đoạn được thay thế (nếu có)', input('supersedes')),
    field('Diễn giải nghiệp vụ nội bộ', statement), field('Câu được phép đưa vào email khách (tuỳ chọn)', client), check);
  formSubmit(form, 'Duyệt đúng đoạn này', async data => {
    const scope = labels.map((_, i) => data.get('scope' + i));
    await request('approve', { ...Object.fromEntries(data), scope, sha: doc.sha, paragraph: part.paragraph,
      digest: part.digest, confirmed: data.has('confirmed') });
    await refresh();
    await openDocument(doc.sha, currentDoc.offset, currentDoc.query);
    status.textContent = 'Đã duyệt và cập nhật phiên bản kho.';
  });
  return form;
}

async function openDocument(sha, offset = 0, query = '') {
  const doc = await request('document/' + sha + '?offset=' + offset + '&q=' + encodeURIComponent(query));
  currentDoc = { sha, offset, query };
  const target = byId('document-detail');
  const search = document.createElement('form');
  const term = input('query', 'search');
  term.value = query;
  search.append(field('Tìm đoạn trong tài liệu', term));
  formSubmit(search, 'Tìm đoạn', data => openDocument(sha, 0, data.get('query')));
  target.replaceChildren(element('h2', doc.name), element('p', 'Chủ nguồn · ' + doc.owner, 'meta'),
    element('p', doc.permission, 'meta'));
  const reference = doc.permission.match(/https:\/\/[^\s]+/u)?.[0];
  if (reference) {
    const link = element('a', 'Mở nguồn công khai');
    link.href = reference;
    link.target = '_blank';
    link.rel = 'noreferrer noopener';
    target.append(link);
  }
  if (doc.suggestedReview?.retired) target.append(element('p', 'Phiếu cũ đã được thay bằng bản Công báo.', 'meta'));
  target.append(search);
  for (const part of doc.paragraphs) {
    const row = element('article', '', 'passage');
    const approved = doc.review.find(item => item.paragraph === part.paragraph && item.active);
    row.append(element('span', 'Đoạn ' + part.paragraph + (approved ? ' · Đã duyệt · ' + approved.id : ''), 'meta'),
      element('blockquote', part.quote));
    if (approved && catalogue.reviewer) row.append(button('Thu hồi đoạn', async () => {
      if (!window.confirm('Thu hồi đoạn này khỏi kho đang dùng?')) return;
      await request('withdraw', { id: approved.id });
      await refresh();
      await openDocument(sha, offset, query);
    }));
    const canReview = !doc.suggestedReview || (!doc.suggestedReview.retired && doc.suggestedReview.paragraph === part.paragraph);
    if (!approved && canReview && !part.tooLong && part.quote.length >= 12 && catalogue.reviewer) {
      const detail = document.createElement('details');
      detail.append(element('summary', 'Rà và duyệt'), reviewForm(doc, part));
      row.append(detail);
    }
    target.append(row);
  }
  const paging = element('div', '', 'controls');
  if (offset > 0) paging.append(button('Trang trước', () => openDocument(sha, offset - 30, query)));
  if (offset + 30 < doc.count) paging.append(button('Trang sau', () => openDocument(sha, offset + 30, query)));
  target.append(paging);
}

function toBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',', 2)[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const importForm = byId('import');
importForm.onsubmit = event => {
  event.preventDefault();
  void run(importForm.querySelector('button'), async () => {
    const data = new FormData(importForm);
    const failures = [];
    let added = 0;
    let duplicates = 0;
    for (const file of data.getAll('files')) {
      if (file.size > 12 * 1024 * 1024) {
        failures.push(file.name + ' vượt giới hạn 12 MiB.');
        continue;
      }
      try {
        const result = await request('import', { name: file.name, base64: await toBase64(file),
          owner: data.get('owner'), permission: data.get('permission'), allowed: data.has('allowed') });
        if (result.duplicate) duplicates++;
        else added++;
      } catch (error) {
        failures.push(file.name + ' · ' + error.message);
      }
    }
    await refresh();
    status.textContent = added + ' tệp vào hàng chờ · ' + duplicates + ' tệp trùng. ' + failures.join(' ');
    status.dataset.error = String(failures.length > 0);
    if (!failures.length) importForm.reset();
  });
};

const create = byId('create-plan');
create.onsubmit = event => {
  event.preventDefault();
  void run(create.querySelector('button'), async () => {
    const data = new FormData(create);
    const result = await request('pilot', { ...Object.fromEntries(data), sources: data.getAll('source'),
      questions: data.get('questions').split(/\r?\n/).map(item => item.trim()).filter(Boolean) });
    await refresh();
    await openPlan(result.id);
  });
};

const criteriaLabels = { decision: 'Kết luận hoặc dừng đúng', citation: 'Dẫn đúng đoạn', conditions: 'Giữ đủ điều kiện', draft: 'Bản nháp phù hợp' };
const format = ms => (ms / 1000).toFixed(1) + ' giây';

async function openPlan(id) {
  currentPlan = id;
  const plan = await request('pilot/' + id);
  if (currentPlan !== id) return;
  clearInterval(timer);
  const target = byId('plan-detail');
  target.replaceChildren(element('h2', plan.title), element('p', plan.mode === 'human' ? 'Người dùng trực tiếp' : 'Diễn tập kỹ thuật', 'meta'));
  if (plan.canGrade) {
    target.append(button('Mở phiếu chấm mù', async () => renderBlind(target, id, await request('pilot/' + id + '/blind'))));
    return;
  }
  target.append(button('Xem kết quả đã chấm', async () => {
    const report = await request('pilot/' + id + '/report');
    const panel = element('div', '', 'result');
    for (const arm of report.summary) panel.append(element('p', (arm.arm === 'copilot' ? 'Copilot' : 'Agent trực tiếp') +
      ' · Đạt ' + arm.passed + '/' + arm.count + ' · Thao tác ' + format(arm.activeMs) + ' · Chờ ' + format(arm.waitingMs) +
      ' · Thao tác trên ca cùng đạt ' + format(arm.pairedActiveMs)));
    panel.append(element('p', 'Số ca cả hai nhánh đạt · ' + report.paired, 'meta'));
    target.append(panel);
  }));
  if (!plan.questions) return;
  plan.questions.forEach((question, caseIndex) => {
    const row = element('section', '', 'result');
    row.append(element('h3', question));
    const arms = caseIndex % 2 ? ['direct', 'copilot'] : ['copilot', 'direct'];
    for (const arm of arms) renderAttempt(row, plan, caseIndex, arm);
    target.append(row);
  });
  timer = setInterval(() => {
    for (const clock of target.querySelectorAll('[data-clock]')) {
      clock.textContent = 'Thao tác ' + format(Number(clock.dataset.base) + Math.max(0, Date.now() - Number(clock.dataset.clock)));
    }
  }, 400);
}

function renderAttempt(parent, plan, caseIndex, arm) {
  const attempt = plan.attempts.find(item => item.caseIndex === caseIndex && item.arm === arm);
  const row = element('div', '', 'panel');
  row.append(element('h3', arm === 'copilot' ? 'Copilot' : 'Agent trực tiếp'));
  const controls = element('div', '', 'controls');
  const act = async (action, extra = {}) => {
    await request('pilot/' + plan.id + '/act', { caseIndex, arm, action, ...extra });
    await openPlan(plan.id);
  };
  const certify = () => plan.mode !== 'human' || window.confirm('Tôi là người thao tác được phân công và xác nhận đang trực tiếp thực hiện bước này.');
  if (!attempt) {
    controls.append(button('Bắt đầu đồng hồ', async () => {
      if (certify()) await act('start', { operatorConfirmed: true });
    }, 'primary'));
  } else {
    const clock = element('span', 'Thao tác ' + format(attempt.activeMs), 'meta');
    if (attempt.phase === 'active') {
      clock.dataset.clock = attempt.changedAt;
      clock.dataset.base = attempt.activeMs;
      controls.append(button('Tạm dừng', () => act('pause')));
      if (!attempt.output) controls.append(button('Giao câu hỏi cho model', () => act('generate'), 'primary'));
    }
    if (attempt.phase === 'waiting') controls.append(button('Khôi phục nếu đã chờ quá ' + plan.recoverySeconds + ' giây', () => act('recover')));
    if (attempt.phase === 'paused') controls.append(button('Tiếp tục đồng hồ', () => act('resume'), 'primary'));
    row.append(clock, element('p', 'Chờ model ' + format(attempt.waitingMs), 'meta'));
    if (attempt.error) row.append(element('p', attempt.error, 'meta'));
    if (attempt.phase === 'complete') row.append(element('p', 'Đã lưu bản rà soát.'));
  }
  row.append(controls);
  if (attempt?.output && attempt.phase !== 'complete') {
    const current = drafts.get(attempt.id) ?? { answer: attempt.output.answer, email: attempt.output.email,
      citations: attempt.output.citations.join(', ') };
    drafts.set(attempt.id, current);
    const form = document.createElement('form');
    const source = element('blockquote');
    source.hidden = true;
    const origin = element('a', 'Mở tài liệu cơ quan');
    origin.hidden = true;
    origin.target = '_blank';
    origin.rel = 'noopener noreferrer';
    const lookup = async sourceId => {
      const found = await request('pilot/' + plan.id + '/source?id=' + encodeURIComponent(sourceId.trim()));
      source.textContent = (found.locator ?? found.title + ' · Đoạn ' + found.paragraph) + '\n\n' + found.quote;
      origin.hidden = !found.origin;
      if (found.origin) origin.href = found.origin;
      source.hidden = false;
    };
    if (arm === 'copilot') {
      const links = element('div', '', 'controls');
      for (const [i, id] of attempt.output.citations.entries()) links.append(button('Mở đoạn ' + (i + 1), () => lookup(id)));
      row.append(links);
    } else {
      const lookupField = input('lookup');
      row.append(field('Mã đoạn từ câu trả lời', lookupField), button('Mở đoạn theo mã', () => lookup(lookupField.value)));
    }
    row.append(source, origin);
    for (const [key, label] of [['answer', 'Câu trả lời đã rà'], ['email', 'Bản nháp email'], ['citations', 'Mã đoạn dẫn chứng, cách nhau bằng dấu phẩy']]) {
      const editor = key === 'citations' ? input(key) : element('textarea');
      editor.value = current[key];
      editor.rows = 5;
      editor.oninput = () => { current[key] = editor.value; };
      form.append(field(label, editor));
    }
    form.append(button('Sao chép email', async () => {
      await navigator.clipboard.writeText(current.email);
      status.textContent = 'Đã sao chép bản nháp.';
    }));
    if (attempt.phase === 'active') formSubmit(form, 'Lưu bản đã rà và dừng đồng hồ', async () => {
      if (certify()) await act('finish', { ...current, citations: current.citations.split(',').map(id => id.trim()).filter(Boolean), operatorConfirmed: true });
    });
    row.append(form);
  }
  parent.append(row);
}

function renderBlind(target, id, pack) {
  const form = document.createElement('form');
  for (const item of pack.cases) {
    const section = element('section', '', 'result');
    section.append(element('h3', item.question), element('p', 'Mã · ' + item.code, 'meta'),
      element('blockquote', item.answer), element('blockquote', item.email), element('p', 'Đoạn dẫn · ' + item.citations.join(', '), 'meta'));
    for (const key of pack.criteria) {
      const select = choice([['', 'Chọn'], ['pass', 'Đạt'], ['fail', 'Chưa đạt']], item.code + '-' + key);
      select.required = true;
      section.append(field(criteriaLabels[key], select));
    }
    section.append(field('Ghi chú', input(item.code + '-note')));
    form.append(section);
  }
  formSubmit(form, 'Khóa phiếu chấm', async data => {
    const grades = pack.cases.map(item => ({ code: item.code,
      ...Object.fromEntries(pack.criteria.map(key => [key, data.get(item.code + '-' + key) === 'pass'])),
      note: data.get(item.code + '-note') }));
    await request('pilot/' + id + '/grade', { grades });
    status.textContent = 'Đã khóa phiếu chấm.';
    target.replaceChildren(element('h2', 'Đã lưu phiếu chấm'));
  });
  const sources = element('details');
  sources.append(element('summary', 'Đoạn nguồn đã khóa'));
  for (const item of pack.sources) sources.append(element('h3', item.title + ' · Đoạn ' + item.paragraph),
    element('p', item.id, 'meta'), element('blockquote', item.quote));
  target.replaceChildren(element('h2', 'Chấm mù · ' + pack.title), sources, form);
}

for (const key of ['library', 'pilot']) byId('show-' + key).onclick = () => {
  byId('library').hidden = key !== 'library';
  byId('pilot').hidden = key !== 'pilot';
};
const invitation = document.querySelector('meta[name="pilot-invitation"]')?.content;
if (/^[a-f0-9]{24}$/.test(invitation ?? '')) {
  byId('library').hidden = true;
  byId('pilot').hidden = false;
  byId('show-library').hidden = true;
  byId('show-pilot').hidden = true;
  const nav = document.querySelector('header nav');
  nav.querySelector('a').hidden = true;
  nav.append(button('Đăng xuất', async () => {
    const response = await fetch('/api/m5/session/logout', { method: 'POST' });
    if (!response.ok) throw new Error('Chưa đăng xuất được.');
    location.replace('/pilot');
  }));
  byId('plans').closest('.panel').hidden = true;
  byId('plan-detail').parentElement.classList.add('pilot-invitation');
  await run(byId('show-pilot'), () => openPlan(invitation));
} else {
  await run(byId('show-library'), refresh);
}
