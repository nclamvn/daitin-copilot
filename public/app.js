const byId = id => document.getElementById(id);
const text = (id, value) => { byId(id).textContent = value; };
const all = selector => [...document.querySelectorAll(selector)];
const panelMedia = matchMedia('(max-width: 950px)');
const state = { view: 'research', tab: 'evidence', catalog: null, resolution: null, search: null, evidence: [], active: null };
const labels = { research: 'Tra cứu', forms: 'Biểu mẫu', sources: 'Nguồn', search: 'Kết quả tra cứu' };
const resultLabels = {
  grounded: ['Có căn cứ', 'ok'],
  historical: ['Chỉ đối chiếu lịch sử', 'neutral'],
  needs_context: ['Cần bổ sung', 'warn'],
  out_of_coverage: ['Ngoài phạm vi thời gian', 'warn'],
  needs_review: ['Cần rà soát', 'warn']
};
const dateText = date => date ? date.split('-').reverse().join('/') : 'Chưa nhập';
const rangeText = item => 'Từ ' + dateText(item.from) + (item.until ? ' đến trước ' + dateText(item.until) : '');
let resolveRequest;
let searchRequest;
let evidenceSequence = 0;
let inspectorTrigger;

function el(tag, value, className) {
  const node = document.createElement(tag);
  if (value !== undefined) node.textContent = value;
  if (className) node.className = className;
  return node;
}

function link(value, url, primary = false) {
  const a = el('a', value, primary ? 'btn primary' : 'btn');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

function button(value, data, className = 'btn') {
  const node = el('button', value, className);
  node.type = 'button';
  Object.assign(node.dataset, data);
  return node;
}

async function api(path, body, signal) {
  const options = body === undefined ? { signal } : {
    method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  };
  const response = await fetch(path, options);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error);
  return payload;
}

function announce(message) {
  text('announcer', message);
}

function selectTab(tab) {
  state.tab = tab;
  all('[data-tab]').forEach(node => node.setAttribute('aria-pressed', String(node.dataset.tab === tab)));
  byId('evidence-panel').hidden = tab !== 'evidence';
  byId('versions-panel').hidden = tab !== 'versions';
}

function renderEvidence() {
  const rows = state.evidence;
  const item = rows.find(row => row.id === state.active);
  text('source-count', rows.length + ' căn cứ');
  const picks = byId('source-picks');
  picks.replaceChildren(...rows.map((row, index) => {
    const pick = button(undefined, { evidence: row.id }, 'source-pick');
    pick.setAttribute('aria-pressed', String(row.id === state.active));
    const number = el('span', String(index + 1).padStart(2, '0'), 'source-number');
    const description = el('span');
    description.append(el('strong', row.locator), el('small', row.title));
    pick.append(number, description);
    return pick;
  }));
  picks.hidden = !rows.length;
  byId('source-empty').hidden = Boolean(item);
  for (const id of ['paper', 'source-meta', 'source-actions']) byId(id).hidden = !item;
  all('.date-control, .source-ref').forEach(node => node.setAttribute('aria-pressed', String(node.dataset.evidence === state.active)));
  if (!item) return;
  text('paper-kind', item.kind);
  text('paper-page', 'Trang PDF ' + item.page);
  text('paper-title', item.documentTitle);
  text('paper-locator', item.locator);
  text('paper-summary', item.summary);
  text('paper-quote', item.quote ? '“' + item.quote + '”' : '');
  byId('paper-quote').hidden = !item.quote;
  byId('paper-caption').hidden = !item.quote;
  text('source-authority', item.authority);
  text('source-range', rangeText(item));
  text('source-checked', dateText(state.catalog.checkedThrough));
  byId('source-snapshot').href = item.snapshotUrl;
  byId('source-original').href = item.originalUrl;
}

function setEvidence(rows, preferred) {
  evidenceSequence++;
  state.evidence = rows;
  state.active = rows.some(item => item.id === preferred) ? preferred : rows[0]?.id;
  selectTab('evidence');
  renderEvidence();
}

function closeInspector(restore = true) {
  const inspector = byId('inspector');
  if (!inspector.classList.contains('open')) return;
  inspector.classList.remove('open');
  inspector.removeAttribute('role');
  inspector.removeAttribute('aria-modal');
  for (const selector of ['.rail', '.top', '#main']) document.querySelector(selector).inert = false;
  document.body.classList.remove('inspector-open');
  if (restore && inspectorTrigger?.isConnected && !inspectorTrigger.closest('[hidden]')) inspectorTrigger.focus();
  inspectorTrigger = null;
}

function openInspector(trigger) {
  const inspector = byId('inspector');
  if (!panelMedia.matches) {
    const target = byId(state.tab === 'versions' ? 'versions-panel' : state.active ? 'paper' : 'inspector');
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'nearest' });
    return;
  }
  if (!inspector.classList.contains('open')) {
    inspectorTrigger = trigger;
    inspector.classList.add('open');
    inspector.setAttribute('role', 'dialog');
    inspector.setAttribute('aria-modal', 'true');
    for (const selector of ['.rail', '.top', '#main']) document.querySelector(selector).inert = true;
    document.body.classList.add('inspector-open');
    byId('close-inspector').focus();
  } else if (state.active) {
    byId('paper').focus({ preventScroll: true });
  }
}

async function openEvidence(id, trigger) {
  if (!state.catalog) return;
  const sequence = ++evidenceSequence;
  let selected = state.evidence.find(item => item.id === id);
  try {
    if (!selected) selected = await api('/api/evidence/' + encodeURIComponent(id));
    if (sequence !== evidenceSequence) return;
    if (!state.evidence.some(item => item.id === id)) state.evidence = [...state.evidence, selected];
    state.active = id;
    selectTab('evidence');
    renderEvidence();
    openInspector(trigger);
  } catch (error) {
    if (sequence === evidenceSequence) announce(error.message);
  }
}

function selectView(view, focus = true) {
  closeInspector(false);
  state.view = view;
  text('crumb', labels[view]);
  for (const id of Object.keys(labels)) byId('view-' + id).hidden = id !== view;
  all('.nav-btn').forEach(node => {
    if (node.dataset.view === view || (view === 'search' && node.dataset.view === 'research')) node.setAttribute('aria-current', 'page');
    else node.removeAttribute('aria-current');
  });
  if (view === 'search') setEvidence(state.search?.hits ?? []);
  if (view === 'research' || view === 'forms') showResolutionEvidence();
  if (view === 'sources') setEvidence([]);
  if (focus) {
    byId('main').focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
}

function readContext() {
  const mode = byId('mode').value;
  const asOf = byId('as-of').value;
  const receivedOn = mode === 'case' ? byId('received-on').value || null : null;
  const crosses = mode === 'case' && receivedOn && receivedOn < state.catalog.cutover && asOf >= state.catalog.cutover;
  const pending = crosses ? byId('pending').value : '';
  byId('received-field').hidden = mode !== 'case';
  byId('pending-field').hidden = !crosses;
  text('as-of-label', mode === 'case' ? 'Ngày đối chiếu' : 'Ngày dự kiến nộp');
  text('timeline-received-label', mode === 'case' ? 'Ngày tiếp nhận' : 'Dự kiến nộp');
  text('timeline-received', dateText(mode === 'case' ? receivedOn : asOf));
  text('timeline-as-of-label', mode === 'case' ? 'Mốc đối chiếu' : 'Nguồn đã đối chiếu đến');
  text('timeline-as-of', dateText(mode === 'case' ? asOf : state.catalog.checkedThrough));
  return { procedure: byId('procedure').value, mode, asOf, receivedOn, pendingAtCutover: pending ? pending === 'yes' : null };
}

function showResolutionEvidence() {
  const result = state.resolution;
  const preferred = result?.rule === 'transition' ? 'tt20-17-2' : result?.citations[0]?.id;
  setEvidence(result?.citations ?? [], preferred);
}

function formDescription(form) {
  return 'Mẫu số ' + form.number + ' · Phụ lục ' + form.appendix + ' · ' + form.document;
}

function formActions(form, historical = false, selected = true) {
  const actions = el('div', undefined, 'actions');
  actions.append(
    link(historical ? 'Mở trang mẫu lịch sử' : selected ? 'Mở đúng trang mẫu' : 'Xem phiên bản để đối chiếu',
      form.snapshotUrl, selected && !historical),
    link('Nguồn chính thức', form.originalUrl)
  );
  return actions;
}

function renderForms(result) {
  const list = byId('forms-list');
  list.replaceChildren();
  list.hidden = !result?.versions.length;
  text('forms-context', result?.form
    ? result.context.label + ' · Đối chiếu theo ' + dateText(result.applicableOn)
    : result?.title ?? 'Chọn thủ tục và điền dữ kiện để đối chiếu phiên bản.');
  if (!result?.versions.length) return;
  const ordered = [...result.versions].sort((a, b) => Number(b.id === result.form?.id) - Number(a.id === result.form?.id));
  for (const form of ordered) {
    const selected = form.id === result.form?.id;
    const historical = form.editionStatus === 'historical';
    const label = selected ? (historical ? 'Khớp hồ sơ · bản lịch sử' : 'Khớp ngày áp dụng')
      : historical ? 'Bản đã thay'
        : form.editionStatus === 'future' ? 'Chưa tới mốc hiệu lực' : 'Khác mốc hồ sơ';
    const card = el('article', undefined, 'form-card' + (selected ? ' selected' : ''));
    const header = el('div', undefined, 'form-title');
    header.append(el('h3', form.title), el('span', label, 'badge ' + (selected ? 'ok' : 'neutral')));
    card.append(header, el('p', formDescription(form)), el('p', rangeText(form)),
      formActions(form, historical, selected));
    list.append(card);
  }
}

function renderComparison(result) {
  const side = result?.applicableOn && (result.applicableOn < result.context.cutover ? 'early' : 'late');
  for (const id of ['early', 'late']) {
    byId('compare-' + id).dataset.selected = String(id === side);
    text('compare-' + id + '-label', id === side ? 'Mốc đang đối chiếu' : '');
  }
  text('compare-caption', side ? 'Mốc được đánh dấu theo dữ kiện đã nhập.' : 'Bổ sung dữ kiện để xác định mốc áp dụng.');
}

function renderResult(result, error) {
  state.resolution = result;
  const main = byId('resolution');
  const status = error ? ['Cần kiểm tra dữ kiện', 'warn'] : resultLabels[result.status];
  main.setAttribute('aria-busy', 'false');
  main.classList.toggle('needs', status[1] === 'warn');
  const badge = byId('result-status');
  badge.className = 'badge ' + status[1];
  badge.textContent = status[0];
  text('result-context', result?.applicableOn ? 'Ngày áp dụng ' + dateText(result.applicableOn) : '');
  text('result-title', error ? 'Chưa đối chiếu được' : result.title);
  text('result-text', error ?? result.explanation);
  const captions = {
    transition: 'Còn đang giải quyết tại mốc', closed_history: 'Đã giải quyết trước mốc',
    before_cutover: 'Trước mốc hiệu lực', from_cutover: 'Từ mốc hiệu lực',
    missing_date: 'Thiếu ngày tiếp nhận', missing_pending: 'Chưa rõ tình trạng hồ sơ',
    coverage: 'Ngoài khoảng đã đối chiếu'
  };
  text('timeline-status', captions[result?.rule] ?? (error ? 'Kiểm tra dữ kiện' : 'Đối chiếu hồ sơ'));
  byId('timeline').dataset.variant = status[1] === 'warn' ? 'missing' : 'ready';
  const citations = result?.citations ?? [];
  byId('result-citations').replaceChildren(...citations.map((row, index) => {
    const node = button(row.locator, { evidence: row.id }, 'source-ref');
    node.prepend(el('span', String(index + 1).padStart(2, '0')));
    return node;
  }));
  const formBox = byId('result-form');
  formBox.replaceChildren();
  formBox.hidden = !result?.form;
  if (result?.form) {
    const form = result.form;
    const details = el('div');
    const historical = form.editionStatus === 'historical';
    details.append(el('strong', formDescription(form)), el('small',
      historical ? 'Bản lịch sử khớp ngày hồ sơ · chỉ đối chiếu' : 'Biểu mẫu chính thức khớp ngày áp dụng'));
    formBox.append(details, formActions(form, historical));
  }
  byId('go-forms').hidden = !result?.versions.length;
  renderForms(result);
  renderComparison(result);
  if (state.view === 'research' || state.view === 'forms') showResolutionEvidence();
  announce((error ?? result.title) + (result?.form ? '. ' + formDescription(result.form) : ''));
}

function clearResolution() {
  state.resolution = null;
  byId('resolution').setAttribute('aria-busy', 'true');
  byId('result-status').className = 'badge neutral';
  text('result-status', 'Đang đối chiếu');
  text('result-context', '');
  text('result-title', 'Đang kiểm tra phiên bản');
  text('result-text', '');
  byId('result-citations').replaceChildren();
  byId('result-form').hidden = true;
  byId('result-form').replaceChildren();
  byId('go-forms').hidden = true;
  renderForms(null);
  renderComparison(null);
  if (state.view === 'research' || state.view === 'forms') setEvidence([]);
}

async function resolve() {
  if (!state.catalog) return;
  resolveRequest?.abort();
  const current = new AbortController();
  resolveRequest = current;
  const context = readContext();
  clearResolution();
  try {
    const result = await api('/api/resolve', context, current.signal);
    if (resolveRequest === current && !current.signal.aborted) renderResult(result);
  } catch (error) {
    if (resolveRequest === current && !current.signal.aborted) renderResult(null, error.message || 'Máy chủ cục bộ chưa phản hồi.');
  }
}

function chooseCase(id) {
  const examples = {
    early: ['renewal', '2026-06-30', 'yes'],
    late: ['renewal', '2026-07-01', ''],
    missing: ['renewal', '2026-06-30', ''],
    amend: ['certificate_amendment', '2026-07-01', '']
  };
  if (!state.catalog || !Object.hasOwn(examples, id)) return;
  const [procedure, date, pending] = examples[id];
  byId('procedure').value = procedure;
  byId('mode').value = 'case';
  byId('as-of').value = '2026-07-02';
  byId('received-on').value = date;
  byId('pending').value = pending;
  text('case-note', 'Đang dùng dữ kiện hồ sơ minh họa. Dùng ngày tiếp nhận của thủ tục đang tra.');
  all('[data-case]').forEach(node => node.setAttribute('aria-pressed', String(node.dataset.case === id)));
  if (state.view !== 'research') selectView('research');
  resolve();
}

function renderSearch(query, result) {
  state.search = result;
  text('search-caption', '“' + query + '” · Mốc ' + dateText(result.on));
  text('search-message', result.message);
  const action = byId('apply-procedure');
  const suggestion = state.catalog.procedures.find(item => item.id === result.procedure);
  action.hidden = !suggestion;
  if (suggestion) action.textContent = 'Đối chiếu thủ tục: ' + suggestion.label;
  const hits = byId('search-hits');
  hits.replaceChildren();
  hits.hidden = !result.hits.length;
  const statusLabels = { applicable: 'Trong khoảng áp dụng', historical: 'Bản lịch sử', future: 'Chưa tới mốc', unchecked: 'Mốc chưa kiểm' };
  for (const row of result.hits) {
    const item = el('article');
    const header = el('div', undefined, 'form-title');
    header.append(el('h3', row.locator + ' · ' + row.document), el('span', statusLabels[row.status], 'badge neutral'));
    item.append(header, el('p', row.summary), button('Mở căn cứ', { evidence: row.id }));
    hits.append(item);
  }
  selectView('search');
}

byId('query-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!state.catalog) return;
  const query = byId('query').value.trim();
  searchRequest?.abort();
  const current = new AbortController();
  searchRequest = current;
  try {
    const result = await api('/api/search', { query, on: byId('as-of').value || state.catalog.checkedThrough }, current.signal);
    if (searchRequest === current && !current.signal.aborted) renderSearch(query, result);
  } catch (error) {
    if (searchRequest === current && !current.signal.aborted) {
      renderSearch(query, { on: state.catalog.checkedThrough, hits: [], procedure: null, message: error.message });
    }
  }
});

byId('apply-procedure').addEventListener('click', () => {
  if (!state.search?.procedure) return;
  byId('procedure').value = state.search.procedure;
  byId('mode').value = 'prepare';
  byId('as-of').value = state.catalog.checkedThrough;
  byId('received-on').value = '';
  byId('pending').value = '';
  all('[data-case]').forEach(node => node.setAttribute('aria-pressed', 'false'));
  text('case-note', 'Ngày dự kiến nộp đang đặt tại mốc nguồn đã đối chiếu. Có thể sửa theo hồ sơ.');
  selectView('research');
  resolve();
});

byId('case-form').addEventListener('submit', event => { event.preventDefault(); resolve(); });
byId('case-form').addEventListener('change', event => {
  if (['received-on', 'mode', 'procedure'].includes(event.target.id)) byId('pending').value = '';
  all('[data-case]').forEach(node => node.setAttribute('aria-pressed', 'false'));
  text('case-note', 'Dùng ngày tiếp nhận của đúng đơn hoặc yêu cầu đang tra.');
  resolve();
});

document.addEventListener('click', event => {
  const trigger = event.target.closest('button');
  if (!trigger) return;
  if (trigger.dataset.view) {
    searchRequest?.abort();
    selectView(trigger.dataset.view);
  } else if (trigger.dataset.case) {
    searchRequest?.abort();
    chooseCase(trigger.dataset.case);
  } else if (trigger.dataset.evidence) {
    openEvidence(trigger.dataset.evidence, trigger);
  } else if (trigger.dataset.tab) {
    selectTab(trigger.dataset.tab);
  } else if (trigger.hasAttribute('data-compare')) {
    selectTab('versions');
    openInspector(trigger);
  }
});

byId('open-inspector').addEventListener('click', event => openInspector(event.currentTarget));
byId('close-inspector').addEventListener('click', () => closeInspector());
panelMedia.addEventListener('change', () => closeInspector(false));

document.addEventListener('keydown', event => {
  const inspector = byId('inspector');
  if (inspector.classList.contains('open')) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeInspector();
    } else if (event.key === 'Tab') {
      const stops = [...inspector.querySelectorAll('a[href], button:not(:disabled)')].filter(node => node.getClientRects().length);
      if (event.shiftKey && document.activeElement === stops[0]) {
        event.preventDefault();
        stops.at(-1)?.focus();
      } else if (!event.shiftKey && document.activeElement === stops.at(-1)) {
        event.preventDefault();
        stops[0]?.focus();
      }
    }
  } else if (event.key === '/' && !event.altKey && !event.metaKey && !event.ctrlKey &&
      !event.target.closest('input, textarea, select, [contenteditable]')) {
    event.preventDefault();
    byId('query').focus();
  }
});

async function start() {
  try {
    state.catalog = await api('/api/catalog');
    const { procedures, coveredFrom, checkedThrough, release, documents, dataStatus, releaseDigest } = state.catalog;
    if (dataStatus === 'preview') {
      const badge = byId('demo-badge');
      badge.classList.add('preview-badge');
      badge.textContent = 'SOT chờ duyệt';
      badge.title = 'Dữ liệu ứng viên, đang chờ luật sư Đại Tín rà soát';
    }
    const options = procedures.map(item => {
      const option = el('option', item.label);
      option.value = item.id;
      return option;
    });
    byId('procedure').replaceChildren(...options);
    text('catalog-scope', 'Việt Nam · Nhãn hiệu quốc gia · ' + dateText(coveredFrom) + ' đến ' + dateText(checkedThrough) + ' · Bản ' + release);
    if (releaseDigest) {
      byId('catalog-scope').after(el('p', (dataStatus === 'preview' ? 'Ứng viên chờ luật sư rà soát' : 'Bản đã duyệt') +
        ' · SHA-256 ' + releaseDigest, 'meta-note'));
    }
    for (const doc of documents) {
      const card = el('article');
      const actions = el('div', undefined, 'actions');
      actions.append(link('Xem bản lưu', doc.snapshotUrl), link('Nguồn chính thức', doc.originalUrl));
      card.append(el('h3', doc.documentTitle), el('p', doc.kind + ' · ' + doc.authority),
        el('p', 'SHA-256 ' + doc.sha256, 'meta-note'), actions);
      byId('source-list').append(card);
    }
    chooseCase('early');
  } catch (error) {
    renderResult(null, error.message || 'Không nạp được bộ nguồn.');
  }
}

start();
