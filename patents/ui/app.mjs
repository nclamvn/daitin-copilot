const $ = id => document.getElementById(id);
const state = { status: null, catalog: null, cases: [], matter: null, selected: new Map(), view: 'search',
  detail: null, search: null, catalogLimit: 10, busy: false, claimRecordId: null, d1RecordIds: new Set(), dirty: { inputs: false, matrix: false, response: false } };
const views = ['search', 'matrix', 'response', 'history'];
const assessmentLabels = { disclosed: 'Có đoạn tương ứng trong D1', not_found: 'Chưa tìm thấy trong nguồn chọn', uncertain: 'Chưa đủ dữ kiện đối chiếu' };
const kindLabels = { patent: 'Tài liệu sáng chế', law: 'Quy định pháp luật', guidance: 'Hướng dẫn', procedure: 'Thủ tục', commentary: 'Bình luận thực hành' };
const mobile = matchMedia('(max-width:800px)');
const node = (tag, value, className) => { const e = document.createElement(tag); if (value !== undefined) e.textContent = value; if (className) e.className = className; return e; };
const date = value => { if (!value) return 'Chưa xác định'; if (/^\d{4}$/.test(value)) return value + ' (chưa rõ ngày)'; const parsed = new Date(value); return Number.isFinite(parsed.valueOf()) ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeZone: 'Asia/Ho_Chi_Minh' }).format(parsed) : 'Chưa xác định'; };
const shorten = (text, max = 320) => typeof text === 'string' && text.length > max ? text.slice(0, max) + '…' : text ?? '';
const section = key => state.matter?.sections?.[key];
const pinId = item => item.record.id;
const isClaim = record => record.kind === 'patent' && (Boolean(record.claims?.length) || record.locator?.section === 'claim' || Number.isInteger(record.locator?.claim));
const isOCR = item => /ocr.*unreviewed|unreviewed.*ocr/i.test(item.record.textFidelity ?? item.source.textFidelity ?? '');
const extractionWarning = item => item.record.knownExtractionWarning || item.source.knownExtractionWarning;
const needsOriginal = item => Boolean(item.record.requiresOriginalCheck || item.source.requiresOriginalCheck);
const publicationKey = record => typeof record?.publicationIdentifier === 'string' ? record.publicationIdentifier.toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
function samePublication(a, b) { return Boolean(a && b && ((a.sourceId && a.sourceId === b.sourceId) || (publicationKey(a) && publicationKey(a) === publicationKey(b)))); }
function d1Blocked(id, claimId = state.claimRecordId) { return samePublication(state.selected.get(id)?.record, state.selected.get(claimId)?.record); }
function capturedURL(item) { if (typeof item.openUrl === 'string' && item.openUrl.startsWith('/api/patents/source/')) return item.openUrl; if (!item.source.snapshot || !/^[a-f0-9]{64}$/.test(item.source.sha256 ?? '')) return null; return '/api/patents/source/' + encodeURIComponent(item.source.id) + '/' + item.source.sha256 + (/\.pdf$/i.test(item.source.snapshot) && Number.isInteger(item.record.locator?.page) ? '#page=' + item.record.locator.page : ''); }
const originalURL = item => item.originalUrl ?? item.source.url;
function safeLink(label, value) { const a = node('a', label); try { if (typeof value !== 'string' || !value.trim()) throw Error(); const url = new URL(value, location.origin); if (!['https:', 'http:'].includes(url.protocol)) throw Error(); a.href = url.href; } catch { return node('span', label + ' chưa có liên kết'); } a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; }
function button(label, handler, className = 'quiet') { const e = node('button', label, className); e.type = 'button'; e.addEventListener('click', handler); return e; }
function notify(text, error = false, reload = false) { $('notice').hidden = false; $('notice-text').textContent = text; $('notice').toggleAttribute('data-error', error); $('reload-case').hidden = !reload; }
function isDirty() { return Object.values(state.dirty).some(Boolean); }
function discard() { return !isDirty() || confirm('Có nội dung chưa lưu trong hồ sơ này. Mở công việc khác và bỏ phần chưa lưu?'); }

async function request(path, body) {
  let response;
  try { response = await fetch('/api/patents/' + path, body === undefined ? undefined : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  }); } catch { const error = new Error('Chưa kết nối được dịch vụ. Giữ nội dung đang nhập và mở lại hồ sơ để kiểm tra trước khi gửi lại.'); error.unknownOutcome = true; throw error; }
  const value = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(value.error ?? 'Chưa thực hiện được. Bản đã lưu vẫn được giữ.'); error.status = response.status; throw error; }
  return value;
}
async function run(label, action, success) {
  if (state.busy) return;
  state.busy = true; $('saved-state').textContent = label; refreshControls();
  try { await action(); if (success) notify(success); }
  catch (error) { notify(error.status === 401 ? 'Phiên đăng nhập đã hết. Tải lại trang để đăng nhập và mở hồ sơ đã lưu.' : error.message, true, (error.status === 409 || error.unknownOutcome) && Boolean(state.matter)); }
  finally { state.busy = false; $('saved-state').textContent = isDirty() ? 'Có phần chưa lưu' : state.matter ? 'Đã lưu' : 'Đã mở kho nguồn'; refreshControls(); }
}
function mode(view) {
  if (!views.includes(view) || (view !== 'search' && !state.matter)) return;
  const changed = state.view !== view; state.view = view;
  for (const key of views) { $('view-' + key).hidden = view !== key; $('tab-' + key).setAttribute('aria-selected', String(view === key)); $('tab-' + key).tabIndex = view === key ? 0 : -1; }
  document.querySelector('.composer-area').hidden = !state.matter || view === 'history';
  if (changed) $('document-scroll').scrollTop = 0;
}
function panel(open) { $('evidence-panel').classList.toggle('mobile-open', open); $('evidence-panel').hidden = !open && !mobile.matches; $('work-grid').classList.toggle('no-panel', !open && !mobile.matches); $('open-evidence').setAttribute('aria-expanded', String(open)); }
function rail(open) { $('rail').classList.toggle('mobile-open', open); $('open-rail').setAttribute('aria-expanded', String(open)); }
function showDialog(title, content) { $('dialog-title').textContent = title; $('dialog-body').replaceChildren(content); $('dialog').showModal(); }
function pickText(target, changed = () => {}) {
  const input = node('input'); input.type = 'file'; input.accept = '.txt,.md,text/plain,text/markdown'; input.hidden = true;
  input.addEventListener('cancel', () => input.remove(), { once: true });
  input.addEventListener('change', async () => {
    const file = input.files?.[0]; input.remove(); if (!file) return;
    try {
      if (!/\.(?:txt|md)$/i.test(file.name) || file.size > 48 * 1024) throw Error('Chọn tệp TXT/MD UTF-8 tối đa 48 KiB.');
      const text = await file.text(); if (!text.trim() || text.includes('\uFFFD') || text.length > target.maxLength) throw Error('Tệp cần UTF-8, không rỗng và tối đa ' + target.maxLength.toLocaleString('vi-VN') + ' ký tự.');
      target.value = text; changed(); notify('Đã đọc tệp vào ô nhập. Lưu hồ sơ để giữ nội dung trên máy chủ.');
    } catch (error) { notify(error.message, true); }
  }, { once: true });
  document.body.append(input); input.click();
}
function setDirty(key) { state.dirty[key] = true; $('saved-state').textContent = 'Có phần chưa lưu'; refreshControls(); }
function selectedChanged() { state.dirty.inputs = Boolean(state.matter); renderEvidence(); refreshControls(); }
function role(source, record) { return /secondary/.test(record.provenance ?? '') || source.kind === 'secondary' || /daitin|Đại Tín/iu.test(source.authority ?? '') ? 'Hướng dẫn thứ cấp' : record.provenance === 'assistant_proposed' ? 'Nội dung đề xuất, chưa xác minh' : record.provenance === 'captured_primary' ? 'Nguồn sơ cấp' : 'Nguồn gốc đã thu thập'; }
function locator(record) { const loc = record.locator; return typeof loc === 'string' ? loc : loc?.label ?? (loc?.claim ? 'Yêu cầu bảo hộ ' + loc.claim : loc?.page ? 'Trang ' + loc.page : 'Vị trí chưa xác định'); }
function badges(item) {
  const wrap = node('div', undefined, 'source-role');
  const label = role(item.source, item.record);
  wrap.append(node('span', kindLabels[item.record.kind] ?? 'Đoạn nguồn'), node('span', label, label.includes('thứ cấp') ? 'secondary' : ''), node('span', item.record.jurisdiction ?? item.source.jurisdiction ?? 'Chưa rõ phạm vi'), node('span', locator(item.record)));
  if (isOCR(item)) wrap.append(node('span', 'OCR, cần đối chiếu bản gốc', 'ocr-warning'));
  else if (needsOriginal(item)) wrap.append(node('span', 'Cần đối chiếu bản gốc', 'ocr-warning'));
  if (extractionWarning(item)) wrap.append(node('span', 'Bản trích có lỗi, chưa dùng để duyệt', 'extraction-warning'));
  return wrap;
}
function evidenceDates(item) {
  const record = item.record;
  const values = [];
  if (record.publicationDate) values.push('Công bố ' + date(record.publicationDate));
  if (record.priorityDate) values.push('Ưu tiên ' + date(record.priorityDate));
  if (record.effectiveFrom) values.push('Từ ' + date(record.effectiveFrom));
  if (record.effectiveTo) values.push('Đến ' + date(record.effectiveTo));
  if (record.kind === 'patent') {
    if (!record.priorityDate) values.push('Ngày ưu tiên chưa xác minh');
    if (!record.legalStatus) values.push('Tình trạng quyền chưa xác minh');
  }
  if (!values.length) values.push(record.kind === 'patent' ? 'Ngày ưu tiên/tình trạng quyền: chưa xác minh trong bản ghi này' : 'Mốc áp dụng: cần đối chiếu riêng');
  return values.join(' · ');
}
async function fullEvidence(item) { if (typeof item.record.text === 'string') return item; return request('evidence/' + encodeURIComponent(item.record.id)); }
async function choose(item) { if (!state.selected.has(pinId(item)) && state.selected.size >= 8) return notify('Pilot dùng tối đa 8 đoạn nguồn công khai trong một hồ sơ. Bỏ một đoạn trước khi thêm.', true); await run('Đang mở đoạn nguồn…', async () => { const full = await fullEvidence(item); state.selected.set(pinId(full), full); state.detail = pinId(full); selectedChanged(); }, 'Đã chọn nguồn. Lưu vào hồ sơ để dùng cho phân tích.'); }
async function inspect(item) { await run('Đang mở nguồn…', async () => { const full = await fullEvidence(item); state.detail = pinId(full); state.detailRecord = full; renderEvidence(); panel(true); }); }

function renderSource(item, preview = false) {
  const row = node('article', undefined, 'source-result');
  const head = node('div', undefined, 'result-heading');
  head.append(node('h3', item.record.title ?? item.source.title), button(state.selected.has(pinId(item)) ? 'Đã chọn' : 'Chọn nguồn', () => choose(item)));
  head.lastChild.disabled = state.selected.has(pinId(item)) || state.busy;
  head.lastChild.dataset.keepDisabled = String(state.selected.has(pinId(item)));
  row.append(head, badges(item), node('p', preview ? item.record.textPreview ?? 'Mở đoạn nguồn để đọc nội dung.' : shorten(item.record.text, 650), 'source-excerpt'));
  if (preview) row.append(node('p', 'Bản xem rút gọn; mở đoạn nguồn để đọc và đối chiếu nguyên văn.', 'source-meta'));
  const links = node('div', undefined, 'source-links');
  links.append(button('Mở đúng đoạn', () => inspect(item), 'text-button'));
  if (capturedURL(item)) links.append(safeLink('Bản nguồn đã lưu', capturedURL(item)));
  links.append(safeLink('Nguồn gốc trực tuyến', originalURL(item)));
  row.append(links, node('p', (item.source.authority ?? 'Cơ quan nguồn chưa xác định') + ' · ' + evidenceDates(item), 'source-meta'));
  return row;
}
function catalogItems() {
  const sources = new Map((state.catalog?.sources ?? []).map(item => [item.id, item]));
  const wanted = $('catalog-kind').value;
  return (state.catalog?.records ?? []).filter(record => !wanted || (wanted === 'guidance' ? ['guidance', 'procedure', 'commentary'].includes(record.kind) : record.kind === wanted))
    .map(record => ({ record, source: sources.get(record.sourceId) ?? {}, openUrl: record.openUrl }))
    .sort((a, b) => Number(b.record.id === state.status?.demo?.claimRecordId) - Number(a.record.id === state.status?.demo?.claimRecordId) || Number(b.record.kind === 'patent') - Number(a.record.kind === 'patent'));
}
function renderResults() {
  const box = $('search-results'); box.replaceChildren();
  $('catalog-heading').hidden = Boolean(state.search);
  if (state.search) {
    const result = state.search;
    box.append(node('p', result.notice ?? (result.status === 'not_found' ? 'Chưa có nguồn phù hợp trong bản dữ liệu này. Thử từ khóa khác hoặc mở phạm vi kho.' : result.status === 'needs_context' ? 'Cần bổ sung ngày hoặc phạm vi trước khi áp dụng căn cứ.' : 'Các đoạn nguồn tìm được để đối chiếu.'), 'result-note'));
    for (const item of result.results ?? []) box.append(renderSource(item));
    if (!(result.results ?? []).length) box.append(button('Duyệt nguồn đã thu thập', () => { state.search = null; renderResults(); }));
  } else {
    const items = catalogItems();
    box.append(node('p', (state.catalog?.sources?.length ?? 0) + ' nguồn · ' + (state.catalog?.records?.length ?? 0) + ' đoạn đã đánh chỉ mục. Nội dung ứng viên chờ luật sư rà soát.', 'result-note'));
    for (const item of items.slice(0, state.catalogLimit)) box.append(renderSource(item, true));
    if (!items.length) box.append(node('p', 'Chưa có bản ghi trong bộ lọc này. Các nguồn chỉ có metadata được ghi riêng trong phạm vi kho.', 'result-note'));
    if (items.length > state.catalogLimit) box.append(button('Xem thêm ' + Math.min(10, items.length - state.catalogLimit) + ' đoạn nguồn', () => { state.catalogLimit += 10; renderResults(); }));
  }
}
function renderEvidence() {
  $('selected-count').textContent = state.selected.size + ' đoạn nguồn';
  const list = $('selected-sources'); list.replaceChildren();
  if (!state.selected.size) list.append(node('p', 'Chọn một đoạn trong thư mục hoặc kết quả tra cứu. Nguồn được lưu riêng với hồ sơ khi anh chị xác nhận.', 'empty-evidence'));
  for (const [id, item] of state.selected) {
    const row = node('div', undefined, 'selected-item' + (state.detail === id ? ' active' : ''));
    row.append(button(item.record.title ?? item.source.title, () => { state.detail = id; renderEvidence(); }, ''), node('p', locator(item.record) + ' · ' + role(item.source, item.record), 'source-meta'));
    if ((state.matter?.derivedContextRecordIds ?? []).includes(id)) row.append(node('span', 'Yêu cầu dẫn chiếu', 'derived-claim'), node('p', 'Ngữ cảnh được bổ sung theo dẫn chiếu trong yêu cầu đang xét.', 'source-meta'));
    if (item.record.kind === 'patent') {
      const roles = node('div', undefined, 'evidence-roles');
      if (state.claimRecordId === id) roles.append(node('span', 'Yêu cầu đang xét', 'claim-role'));
      else if (isClaim(item.record)) roles.append(button('Dùng làm yêu cầu đang xét', () => {
        if (state.matter && $('claim-text').value !== state.matter.claimText && !confirm('Thay nội dung yêu cầu đang nhập bằng đoạn nguồn này?')) return;
        state.claimRecordId = id;
        const count = state.d1RecordIds.size; state.d1RecordIds = new Set([...state.d1RecordIds].filter(value => !d1Blocked(value)));
        if (state.matter) { $('claim-text').value = item.record.text; $('claim-version').value = locator(item.record); }
        selectedChanged();
        if (count !== state.d1RecordIds.size) notify('Đã bỏ các đoạn D1 thuộc cùng mã công bố với yêu cầu đang xét. Lưu nguồn để xác nhận vai trò mới.');
      }, 'text-button'));
      const label = node('label', undefined, 'check'); const check = node('input'); check.type = 'checkbox'; check.value = id; check.checked = state.d1RecordIds.has(id); check.disabled = d1Blocked(id); check.dataset.keepDisabled = String(check.disabled);
      check.addEventListener('change', () => { if (check.checked) state.d1RecordIds.add(id); else state.d1RecordIds.delete(id); selectedChanged(); });
      label.append(check, document.createTextNode('Đoạn đối chứng D1')); roles.append(label);
      if (check.disabled) roles.append(node('p', 'Không dùng chính công bố đang xét làm D1.', 'source-meta'));
      row.append(roles);
    }
    if (isOCR(item)) row.append(node('p', 'OCR, cần đối chiếu bản gốc', 'ocr-caption'));
    else if (needsOriginal(item)) row.append(node('p', 'Cần đối chiếu bản gốc trước khi sử dụng.', 'ocr-caption'));
    if (extractionWarning(item)) row.append(node('p', 'Bản trích có vấn đề đã được ghi nhận. Cần thay nguồn trước khi giao AI hoặc duyệt.', 'extraction-caption'));
    row.append(button('Bỏ khỏi lựa chọn', () => { state.selected.delete(id); state.d1RecordIds.delete(id); if (state.claimRecordId === id) state.claimRecordId = null; selectedChanged(); }, 'remove-source'));
    list.append(row);
  }
  const detail = $('evidence-detail'); detail.replaceChildren();
  const item = state.selected.get(state.detail) ?? (state.detailRecord?.record.id === state.detail ? state.detailRecord : null);
  if (item) {
    const block = node('section', undefined, 'evidence-detail');
    block.append(node('h3', item.record.title ?? item.source.title), badges(item), node('pre', item.record.text));
    if (isOCR(item)) block.insertBefore(node('p', 'Lớp chữ OCR chưa được rà soát. Mở trang gốc để xác nhận trước khi dùng đoạn này trong lập luận.', 'evidence-warning'), block.querySelector('pre'));
    else if (needsOriginal(item)) block.insertBefore(node('p', 'Đoạn này cần được đối chiếu với bản gốc trước khi sử dụng.', 'evidence-warning'), block.querySelector('pre'));
    if (extractionWarning(item)) block.insertBefore(node('p', typeof extractionWarning(item) === 'string' ? extractionWarning(item) : 'Bản trích có lỗi đã biết, cần được sửa hoặc thay bằng nguồn phù hợp trước khi duyệt.', 'extraction-caption'), block.querySelector('pre'));
    const links = node('div', undefined, 'source-links');
    if (capturedURL(item)) links.append(safeLink('Bản nguồn đã lưu', capturedURL(item)));
    links.append(safeLink('Nguồn gốc trực tuyến', originalURL(item)));
    if (!state.selected.has(pinId(item))) links.append(button('Chọn đoạn này', () => choose(item), 'text-button'));
    block.append(links, node('p', evidenceDates(item), 'source-meta'), node('p', 'Thu thập ' + date(item.source.capturedAt) + ' · Chưa có duyệt pháp lý của luật sư.', 'source-meta'));
    if (item.record.kind === 'patent' && !item.record.family) block.append(node('p', 'Quan hệ họ sáng chế chưa được xác minh trong bản dữ liệu này.', 'source-meta'));
    const hash = item.source.sha256;
    if (hash) block.append(node('p', 'SHA-256 nguồn ' + hash, 'source-meta'));
    detail.append(block);
  }
  $('create-selected').hidden = Boolean(state.matter);
  $('save-selected').hidden = !state.matter;
}
function renderCases() {
  const query = $('case-filter').value.trim().toLocaleLowerCase('vi');
  const items = state.cases.filter(item => !query || (item.title + ' ' + item.reference).toLocaleLowerCase('vi').includes(query));
  $('case-count').textContent = state.cases.length; $('case-empty').hidden = Boolean(items.length);
  $('case-empty').textContent = state.cases.length ? 'Không có hồ sơ khớp từ khóa.' : 'Chưa có hồ sơ sáng chế.';
  $('case-list').replaceChildren(...items.map(item => {
    const b = button('', () => { if (discard()) openCase(item.id); }, 'case-item');
    b.append(node('strong', item.title), node('small', item.reference)); if (item.id === state.matter?.id) b.setAttribute('aria-current', 'page'); return b;
  }));
}
function approvalText(approval) { if (!approval) return 'Chưa duyệt'; return 'Đã duyệt · ' + (typeof approval.by === 'string' ? approval.by : approval.by?.name ?? 'Luật sư'); }
function setApproval(id, approval, dirty) { $(id).textContent = dirty ? 'Có nội dung chưa lưu' : approvalText(approval); $(id).classList.toggle('approved', Boolean(approval) && !dirty); }
function field(label, value, type = 'textarea', rows = 4) { const wrap = node('label', label); const input = node(type); input.value = value ?? ''; if (type === 'textarea') input.rows = rows; wrap.append(input); return { wrap, input }; }
function renderMatrix() {
  const box = $('matrix-rows'); box.replaceChildren();
  const rows = section('matrix')?.rows ?? [];
  if (!rows.length) box.append(node('p', 'Chưa có ma trận. Thêm một dấu hiệu để đối chiếu bằng tay hoặc giao AI đề xuất theo yêu cầu và nguồn đã lưu.', 'matrix-empty'));
  for (const row of rows) addMatrixRow(row, false);
  setApproval('matrix-approval', section('matrix')?.approval, false);
}
function addMatrixRow(row = {}, dirty = true) {
  if (dirty && $('matrix-rows').querySelectorAll('.matrix-row').length >= 8) return notify('Pilot cho phép tối đa 8 dấu hiệu trong một ma trận.', true);
  $('matrix-rows').querySelector('.matrix-empty')?.remove();
  const item = node('section', undefined, 'matrix-row'); item.dataset.rowId = row.id ?? crypto.randomUUID();
  const feature = field('Dấu hiệu cần đối chiếu', row.feature, 'input'); feature.input.maxLength = 350; feature.input.dataset.field = 'feature';
  const head = node('div', undefined, 'feature-heading'); head.append(feature.wrap, button('Bỏ dấu hiệu', () => { item.remove(); setDirty('matrix'); }, 'remove-row'));
  const columns = node('div', undefined, 'matrix-comparison');
  const claim = node('div', undefined, 'matrix-cell'); claim.append(node('h3', 'Yêu cầu bảo hộ'));
  const cq = field('Đoạn nguyên văn', row.claimQuote); cq.input.dataset.field = 'claimQuote'; cq.input.maxLength = 1400; cq.input.className = 'quote'; claim.append(cq.wrap);
  if (row.claimQuoteRecordId) {
    const evidence = state.matter?.pinnedEvidence.find(item => item.record.id === row.claimQuoteRecordId);
    const origin = node('p', (row.claimQuoteRecordId === state.matter?.claimRecordId ? 'Yêu cầu đang xét: ' : 'Yêu cầu dẫn chiếu: ') + (evidence?.record.title ?? row.claimQuoteRecordId), 'quote-origin');
    origin.title = row.claimQuoteRecordId; claim.append(origin);
    cq.input.addEventListener('input', () => { origin.textContent = 'Trích đoạn đã sửa; nguồn sẽ được kiểm lại khi lưu.'; });
  }
  const d1 = node('div', undefined, 'matrix-cell'); d1.append(node('h3', 'Tài liệu đối chứng D1'));
  const d1Label = node('label', 'Đoạn nguồn đã lưu'); const select = node('select'); select.dataset.field = 'd1RecordId';
  const noEvidence = node('option', 'Chưa xác định đoạn tương ứng'); noEvidence.value = ''; select.append(noEvidence);
  const eligibleD1 = (state.matter?.d1RecordIds ?? []).filter(id => !d1Blocked(id));
  for (const evidence of state.matter?.pinnedEvidence ?? []) { if (!eligibleD1.includes(evidence.record.id)) continue; const option = node('option', shorten(evidence.record.title, 90)); option.value = evidence.record.id; select.append(option); }
  if (row.d1RecordId && !eligibleD1.includes(row.d1RecordId)) { const stale = node('option', 'D1 cũ không còn phù hợp, cần chọn lại'); stale.value = row.d1RecordId; stale.disabled = true; select.append(stale); }
  select.value = row.d1RecordId ?? ''; d1Label.append(select); d1.append(d1Label);
  const dq = field('Đoạn nguyên văn từ D1', row.d1Quote); dq.input.dataset.field = 'd1Quote'; dq.input.maxLength = 1600; dq.input.className = 'quote'; d1.append(dq.wrap, button('Mở đoạn đang chọn', () => { const evidence = state.matter?.pinnedEvidence.find(x => x.record.id === select.value); if (evidence) inspect(evidence); }, 'text-button'));
  const inference = node('div', undefined, 'matrix-cell'); inference.append(node('h3', 'Nhận định cần rà soát'));
  const assessmentLabel = node('label', 'Mức bằng chứng'); const assessment = node('select'); assessment.dataset.field = 'assessment';
  for (const [key, text] of Object.entries(assessmentLabels)) { const option = node('option', text); option.value = key; assessment.append(option); }
  assessment.value = row.assessment ?? 'uncertain'; assessmentLabel.append(assessment);
  const analysis = field('Lập luận / suy luận', row.analysis, 'textarea', 4); analysis.input.dataset.field = 'analysis'; analysis.input.maxLength = 1800;
  const missing = field('Điểm còn thiếu hoặc cần xác nhận', row.missing, 'textarea', 2); missing.input.dataset.field = 'missing'; missing.input.maxLength = 500;
  inference.append(assessmentLabel, analysis.wrap, missing.wrap); columns.append(claim, d1, inference); item.append(head, columns);
  item.addEventListener('input', () => setDirty('matrix')); item.addEventListener('change', () => setDirty('matrix')); $('matrix-rows').append(item);
  if (dirty) setDirty('matrix');
}
function matrixPayload() { return [...$('matrix-rows').querySelectorAll('.matrix-row')].map(item => Object.fromEntries([['id', item.dataset.rowId], ...[...item.querySelectorAll('[data-field]')].map(input => [input.dataset.field, input.dataset.field === 'd1RecordId' ? input.value || null : input.value.trim()])])); }
function renderResponse() {
  $('response-text').value = section('response')?.text ?? '';
  const sources = $('response-sources'); sources.replaceChildren(node('legend', 'Nguồn dùng cho phần phản hồi'));
  sources.append(node('p', 'Chọn tối đa 8 đoạn, gồm nguồn riêng của hồ sơ và căn cứ công khai phù hợp.', 'helper'));
  const privateSources = [['case:claim', 'Yêu cầu đang xét', state.matter?.claimText], ['case:notice', 'Thông báo của hồ sơ', state.matter?.noticeText], ['case:instructions', 'Chỉ dẫn đã xác nhận', state.matter?.instructionsText]]
    .filter(([, , text]) => Boolean(text)).map(([id, title]) => ({ record: { id, title: title + ' · nguồn riêng của nhóm' } }));
  for (const item of [...privateSources, ...(state.matter?.pinnedEvidence ?? [])]) {
    const label = node('label', undefined, 'check'); const input = node('input'); input.type = 'checkbox'; input.value = item.record.id;
    input.checked = (section('response')?.evidenceIds ?? []).includes(item.record.id); input.addEventListener('change', () => { if (input.checked && sources.querySelectorAll('input:checked').length > 8) { input.checked = false; return notify('Phần phản hồi dùng tối đa 8 đoạn nguồn.', true); } setDirty('response'); });
    label.append(input, document.createTextNode(item.record.title ?? item.source.title)); sources.append(label);
  }
  setApproval('response-approval', section('response')?.approval, false);
}
function renderHistory() {
  const box = $('history'); box.replaceChildren(node('h2', 'Các bản đã duyệt', 'history-heading'));
  const releases = state.matter?.releases ?? [];
  if (!releases.length) box.append(node('p', 'Duyệt riêng ma trận và phản hồi để tạo bản xuất đầu tiên. Các bản đã tạo sẽ được giữ nguyên khi tiếp tục chỉnh sửa.', 'result-note'));
  for (const release of releases.toReversed()) {
    const row = node('article', undefined, 'release-card'); row.append(node('h3', 'Bản duyệt ' + release.number), node('p', 'Lưu ' + date(release.at ?? release.createdAt), 'source-meta'));
    if (release.sha256 ?? release.digest) row.append(node('p', 'Dấu kiểm ' + (release.sha256 ?? release.digest), 'source-meta'));
    const actions = node('div', undefined, 'section-actions'); actions.append(button('Xem bản đã lưu', () => openRelease(release.number)), downloadLink(release.number)); row.append(actions); box.append(row);
  }
  box.append(node('h2', 'Các lượt đề xuất', 'history-heading'));
  for (const proposal of (state.matter?.proposals ?? []).toReversed()) {
    const run = proposal.run ?? proposal.modelRun ?? {};
    const row = node('div', undefined, 'run-record'); row.append(node('strong', (proposal.targets ?? []).map(x => x === 'matrix' ? 'Ma trận' : 'Phản hồi').join(', ') || 'Lượt đề xuất'), node('p', date(proposal.at ?? proposal.createdAt) + ' · ' + (run.model ?? 'Mô hình chưa có metadata')));
    if (run.elapsedMs !== undefined) row.append(node('p', 'Thời gian máy ' + (run.elapsedMs / 1000).toFixed(2) + ' giây. Không phải thời gian thao tác của luật sư.'));
    box.append(row);
  }
}
function downloadLink(number) { const link = node('a', 'Tải Word bản ' + number, 'quiet'); link.href = '/api/patents/cases/' + encodeURIComponent(state.matter.id) + '/word/' + number; link.download = state.matter.reference.replaceAll('/', '-') + '-ban-' + number + '-daitin.docx'; return link; }
async function openRelease(number) { await run('Đang mở bản đã lưu…', async () => {
  const value = await request('cases/' + state.matter.id + '/releases/' + number); const body = node('div');
  body.append(node('p', 'Bản ' + number + ' được giữ nguyên theo nội dung đã duyệt.', 'dialog-note'), node('h3', 'Yêu cầu đang xét'), node('pre', value.claimText ?? '', 'release-preview'), node('h3', 'Ma trận đã duyệt'));
  for (const row of value.sections?.matrix?.rows ?? []) body.append(node('h4', row.feature), node('pre', 'Yêu cầu: ' + row.claimQuote + '\nD1: ' + (row.d1Quote || 'Chưa có đoạn tương ứng') + '\nNhận định: ' + row.analysis + '\nCần xác nhận: ' + (row.missing || 'Không ghi thêm'), 'release-preview'));
  const response = value.sections?.response;
  body.append(node('h3', 'Phản hồi'), node('pre', typeof response === 'string' ? response : response?.text ?? value.response?.text ?? 'Đọc nội dung đầy đủ trong Word của bản này.', 'release-preview'), node('h3', 'Nguồn được giữ cùng bản duyệt'));
  const ledger = node('ul', undefined, 'gap-list');
  for (const item of value.pinnedEvidence ?? []) { const row = node('li'); row.append(safeLink(item.record.title, capturedURL(item) ?? originalURL(item)), document.createTextNode(' · ' + locator(item.record))); ledger.append(row); }
  body.append(ledger, downloadLink(number)); showDialog('Bản duyệt ' + number, body);
}); }
function applyMatter(matter, nextView = state.view) {
  const different = state.matter?.id !== matter.id;
  state.matter = matter; state.dirty = { inputs: false, matrix: false, response: false };
  state.claimRecordId = matter.claimRecordId ?? null; state.d1RecordIds = new Set(matter.d1RecordIds ?? []);
  state.selected = new Map((matter.pinnedEvidence ?? []).map(item => [pinId(item), item])); state.detail = matter.pinnedEvidence?.at(-1)?.record.id ?? null;
  const samePublicationD1 = [...state.d1RecordIds].filter(id => d1Blocked(id));
  if (samePublicationD1.length) { samePublicationD1.forEach(id => state.d1RecordIds.delete(id)); state.dirty.inputs = true; notify('Đoạn thuộc cùng công bố đang xét không được dùng làm D1. Chọn lại và lưu nguồn trước khi phân tích hoặc duyệt.', true); }
  state.cases = [{ id: matter.id, reference: matter.reference, title: matter.title, version: matter.version, updatedAt: matter.updatedAt }, ...state.cases.filter(item => item.id !== matter.id)];
  $('case-reference').textContent = matter.reference; $('matter-title').textContent = matter.title.replace(/ (\S+)$/u, '\u00a0$1'); $('matter-title').title = matter.title;
  $('matter-context').textContent = shorten(matter.context.claimVersion, 100) + ' · Đối chiếu ' + date(matter.context.asOf) + ' · Hồ sơ mô phỏng';
  $('claim-text').value = matter.claimText; $('claim-version').value = matter.context.claimVersion;
  $('case-notice-text').value = matter.noticeText ?? ''; $('case-instructions-text').value = matter.instructionsText ?? '';
  $('notice-summary').textContent = matter.noticeText ? 'Thông báo và chỉ dẫn đã lưu · mô phỏng' : 'Chưa có thông báo';
  $('claim-summary').textContent = shorten(matter.context.claimVersion, 70) + (matter.claimRecordId ? ' · theo nguồn đã chọn' : ' · nội dung nhập tay');
  $('claim-excerpt').textContent = shorten(matter.claimText.replace(/\s+/g, ' '), 140);
  if (different) { $('private-inputs').open = false; $('claim-inputs').open = false; }
  $('release-count').textContent = matter.releases.length || '';
  const last = matter.releases.at(-1); $('export-latest').hidden = !last; if (last) $('export-latest').textContent = 'Xuất Word bản ' + last.number;
  renderCases(); renderMatrix(); renderResponse(); renderHistory(); renderEvidence(); mode(nextView === 'search' ? 'search' : nextView);
  rail(false); refreshControls();
  if (different) requestAnimationFrame(() => { $('document-scroll').scrollTop = 0; });
}
async function openCase(id) { await run('Đang mở đúng hồ sơ…', async () => { applyMatter(await request('cases/' + encodeURIComponent(id)), 'matrix'); const url = new URL(location.href); url.searchParams.set('case', id); history.pushState({}, '', url); requestAnimationFrame(() => { $('document-scroll').scrollTop = 0; }); }); }
async function mutate(action, values, message) { await run('Đang lưu hồ sơ…', async () => {
  const preserved = {};
  if (state.dirty.inputs && action !== 'source') preserved.inputs = { selected: new Map(state.selected), claimText: $('claim-text').value,
    claimVersion: $('claim-version').value, noticeText: $('case-notice-text').value, instructionsText: $('case-instructions-text').value,
    claimRecordId: state.claimRecordId, d1RecordIds: new Set(state.d1RecordIds) };
  if (state.dirty.matrix && !Object.hasOwn(values, 'matrixRows')) preserved.matrix = matrixPayload();
  if (state.dirty.response && !Object.hasOwn(values, 'response')) preserved.response = { text: $('response-text').value, evidenceIds: [...$('response-sources').querySelectorAll('input:checked')].map(x => x.value) };
  const matter = await request('cases/' + state.matter.id + '/' + action, { version: state.matter.version, ...values }); applyMatter(matter);
  if (preserved.inputs) { state.selected = preserved.inputs.selected; state.claimRecordId = preserved.inputs.claimRecordId; state.d1RecordIds = preserved.inputs.d1RecordIds; $('claim-text').value = preserved.inputs.claimText; $('claim-version').value = preserved.inputs.claimVersion; $('case-notice-text').value = preserved.inputs.noticeText; $('case-instructions-text').value = preserved.inputs.instructionsText; state.dirty.inputs = true; renderEvidence(); }
  if (preserved.matrix) { $('matrix-rows').replaceChildren(); for (const row of preserved.matrix) addMatrixRow(row, false); state.dirty.matrix = true; }
  if (preserved.response) { $('response-text').value = preserved.response.text; $('response-sources').querySelectorAll('input').forEach(input => { input.checked = preserved.response.evidenceIds.includes(input.value); }); state.dirty.response = true; }
}, message); }
async function saveInputs() { if (!state.matter) return; await mutate('source', { evidenceIds: [...state.selected.keys()], claimText: $('claim-text').value,
  claimVersion: $('claim-version').value, claimRecordId: state.claimRecordId, d1RecordIds: [...state.d1RecordIds],
  noticeText: $('case-notice-text').value, instructionsText: $('case-instructions-text').value }, 'Đã lưu nguồn và phiên bản yêu cầu. Kiểm lại phần cần duyệt.'); }
async function propose(targets) {
  if (!state.matter) return;
  if (isDirty()) return notify('Lưu các phần đang sửa và nguồn đã chọn trước khi giao AI.', true);
  await run('AI đang đối chiếu nguồn…', async () => { applyMatter(await request('cases/' + state.matter.id + '/propose', { version: state.matter.version, targets, instruction: $('task').value.trim() || 'Đối chiếu theo nguồn đã lưu, ghi rõ điểm thiếu chứng cứ; soạn nội dung để luật sư rà soát.' }), targets.length === 1 && targets[0] === 'response' ? 'response' : 'matrix'); }, 'Đã lưu đề xuất. Đối chiếu nguồn và duyệt từng phần.');
}
function refreshControls() {
  const active = Boolean(state.matter), busy = state.busy, inputsDirty = state.dirty.inputs || Boolean(state.matter?.sourceChanged);
  const invalidSource = Boolean(state.matter?.pinnedEvidence.some(item => extractionWarning(item)));
  document.querySelector('.composer-area').hidden = !active || state.view === 'history';
  for (const view of views.slice(1)) $('tab-' + view).disabled = !active;
  $('task').disabled = !active || busy || !state.status?.model;
  $('send-task').disabled = !active || busy || !state.status?.model || isDirty() || inputsDirty || invalidSource;
  $('model-state').textContent = invalidSource ? 'Cần thay bản trích có lỗi' : state.status?.model ? 'AI đề xuất, luật sư quyết định' : 'AI chưa bật';
  $('case-example').disabled = busy || !state.status?.demo;
  $('new-case').disabled = busy; $('create-selected').disabled = busy || !state.selected.size;
  $('save-selected').disabled = busy || !active || !inputsDirty; $('save-inputs').disabled = busy || !active || !inputsDirty;
  $('inputs-state').textContent = state.matter?.sourceChanged ? 'Nguồn đã đổi, lưu lại và rà soát phiên bản mới' : inputsDirty ? 'Nguồn / yêu cầu chưa lưu' : active ? 'Đã gắn với hồ sơ' : '';
  $('inputs-state').toggleAttribute('data-dirty', inputsDirty);
  for (const key of ['matrix', 'response']) {
    $('save-' + key).disabled = busy || !active || !state.dirty[key];
    $('propose-' + key).disabled = busy || !active || !state.status?.model || isDirty() || inputsDirty || invalidSource;
    $('approve-' + key).disabled = busy || !active || state.status?.role !== 'reviewer' || inputsDirty || invalidSource || state.dirty[key] || Boolean(section(key)?.approval) ||
      (key === 'matrix' ? !(section(key)?.rows?.length) : !section(key)?.text?.trim());
    $('approve-' + key).title = state.status?.role === 'reviewer' ? '' : 'Cần tài khoản luật sư để duyệt.';
    setApproval(key + '-approval', section(key)?.approval, state.dirty[key]);
  }
  $('add-row').disabled = !active || busy;
  $('export-latest').disabled = busy;
  document.querySelectorAll('#view-matrix input,#view-matrix textarea,#view-matrix select,#view-response input,#view-response textarea').forEach(el => { el.disabled = busy; });
  document.querySelectorAll('#selected-sources button,#selected-sources input,#search-results button,#dialog-body form input,#dialog-body form textarea,#dialog-body form select,#dialog-body form button').forEach(el => {
    el.disabled = busy || el.dataset.keepDisabled === 'true';
  });
}
function createDialog() {
  if (!discard()) return;
  const form = node('form'); form.append(node('p', 'Chọn đoạn yêu cầu và đối chứng từ nguồn công khai. Hồ sơ trong pilot này là mô phỏng; không đưa hồ sơ khách hàng thật vào đây.', 'dialog-note'));
  const grid = node('div', undefined, 'create-grid'); const ref = field('Mã hồ sơ', '', 'input'); ref.input.required = true; ref.input.maxLength = 48; ref.input.placeholder = 'PAT-2026-001'; const title = field('Tên hồ sơ', '', 'input'); title.input.required = true; title.input.maxLength = 160; grid.append(ref.wrap, title.wrap);
  const version = field('Phiên bản yêu cầu bảo hộ', 'Yêu cầu 1', 'input'); version.input.required = true; version.input.maxLength = 100;
  const asOf = field('Ngày đối chiếu đã xác nhận', today(), 'input'); asOf.input.type = 'date'; asOf.input.required = true; grid.append(version.wrap, asOf.wrap); form.append(grid);
  const notice = field('Nội dung thông báo cần phản hồi', '', 'textarea', 4); notice.input.maxLength = 6000; notice.input.required = true;
  const noticeGroup = node('div', undefined, 'create-file-field'); noticeGroup.append(notice.wrap, button('Chọn tệp TXT/MD', () => pickText(notice.input), 'text-button'));
  const instructions = field('Chỉ dẫn đã xác nhận', '', 'textarea', 3); instructions.input.maxLength = 6000; instructions.input.required = true;
  const instructionsGroup = node('div', undefined, 'create-file-field'); instructionsGroup.append(instructions.wrap, button('Chọn tệp TXT/MD', () => pickText(instructions.input), 'text-button'));
  form.append(noticeGroup, instructionsGroup);
  const claim = field('Yêu cầu bảo hộ cần phân tích', '', 'textarea', 6); claim.input.required = true; claim.input.maxLength = 6000;
  const claimLabel = node('label', 'Nguồn của yêu cầu đang xét'); const claimSource = node('select');
  const own = node('option', 'Yêu cầu nhập tay / mô phỏng'); own.value = ''; claimSource.append(own);
  const patents = [...state.selected.values()].filter(item => item.record.kind === 'patent');
  for (const item of patents.filter(item => isClaim(item.record))) { const option = node('option', item.record.title); option.value = item.record.id; claimSource.append(option); }
  claimSource.value = state.claimRecordId ?? '';
  if (state.claimRecordId && state.selected.has(state.claimRecordId)) claim.input.value = state.selected.get(state.claimRecordId).record.text;
  claimLabel.append(claimSource); form.append(claimLabel, claim.wrap);
  const d1 = node('fieldset', undefined, 'create-d1'); d1.append(node('legend', 'Đoạn nguồn dùng làm đối chứng D1'));
  const d1Choices = patents.map(item => { const label = node('label', undefined, 'check'); const input = node('input'); input.type = 'checkbox'; input.value = item.record.id; input.checked = state.d1RecordIds.has(item.record.id); input.disabled = d1Blocked(input.value, claimSource.value); input.dataset.keepDisabled = String(input.disabled); if (input.disabled) input.checked = false; label.append(input, document.createTextNode(item.record.title)); d1.append(label); return input; });
  if (!patents.length) d1.append(node('p', 'Chưa chọn tài liệu sáng chế công bố. Có thể lưu hồ sơ trước, rồi bổ sung nguồn D1 để đối chiếu.', 'helper'));
  claimSource.addEventListener('change', () => { const item = state.selected.get(claimSource.value); if (item) { claim.input.value = item.record.text; version.input.value = locator(item.record); } d1Choices.forEach(input => { input.disabled = d1Blocked(input.value, claimSource.value); input.dataset.keepDisabled = String(input.disabled); if (input.disabled) input.checked = false; }); });
  claim.input.addEventListener('input', () => { claimSource.value = ''; d1Choices.forEach(input => { input.disabled = false; input.dataset.keepDisabled = 'false'; }); });
  form.append(d1, node('p', state.selected.size + ' đoạn nguồn công khai đang chọn sẽ gắn với hồ sơ. Thông báo và chỉ dẫn được lưu riêng theo nhóm. Chưa nhập thông báo PDF trong luồng này.', 'helper'));
  const confirmed = node('label', undefined, 'check'); const check = node('input'); check.type = 'checkbox'; check.required = true; confirmed.append(check, document.createTextNode('Tôi xác nhận đây là hồ sơ mô phỏng.')); form.append(confirmed);
  const submit = node('button', 'Lưu hồ sơ sáng chế', 'primary'); submit.type = 'submit'; form.append(submit);
  form.addEventListener('submit', event => { event.preventDefault(); run('Đang tạo hồ sơ…', async () => { const matter = await request('cases', { synthetic: true, reference: ref.input.value, title: title.input.value, claimText: claim.input.value, claimVersion: version.input.value, jurisdiction: 'VN', asOf: asOf.input.value, evidenceIds: [...state.selected.keys()], claimRecordId: claimSource.value || null, d1RecordIds: d1Choices.filter(input => input.checked && !input.disabled).map(input => input.value), noticeText: notice.input.value, instructionsText: instructions.input.value }); $('dialog').close(); applyMatter(matter, 'matrix'); const url = new URL(location.href); url.searchParams.set('case', matter.id); history.pushState({}, '', url); }, 'Đã lưu hồ sơ mô phỏng và nguồn đã chọn.'); });
  showDialog('Hồ sơ sáng chế mới', form);
}
function datasetDialog() {
  const data = state.status?.dataset ?? {}; const body = node('div');
  body.append(node('p', 'Nguồn đã thu thập và đoạn trích chưa phải SOT pháp lý đã được luật sư phê duyệt.', 'dialog-note'));
  const facts = node('dl', undefined, 'dataset-facts');
  for (const [label, value] of [['Phạm vi', 'Hồ sơ sáng chế Việt Nam; nguồn PCT và tài liệu sáng chế công bố để tham khảo, đối chiếu.'], ['Nguồn / đoạn', (data.sourceCount ?? state.catalog?.sources?.length ?? 0) + ' / ' + (data.recordCount ?? state.catalog?.records?.length ?? 0)], ['Ngày dựng kho', date(data.builtAt)], ['Trạng thái', 'Ứng viên, chờ luật sư rà soát'], ['Dấu kiểm dữ liệu', data.digest ?? state.catalog?.datasetDigest ?? 'Chưa có']]) facts.append(node('dt', label), node('dd', value));
  body.append(facts, node('h3', 'Nguồn trong kho'));
  const list = node('ul', undefined, 'gap-list');
  for (const source of state.catalog?.sources ?? []) { const item = node('li'); item.append(safeLink(source.title, source.url), document.createTextNode(' · ' + (source.authority ?? 'Chưa rõ cơ quan') + ' · ' + (source.access === 'metadata_only' || !source.snapshot ? 'Chỉ có metadata, chưa có toàn văn' : 'Có bản thu thập') + ' · Thu thập ' + date(source.capturedAt))); list.append(item); }
  body.append(list, node('h3', 'Phần còn thiếu'));
  const gaps = node('ul', undefined, 'gap-list');
  for (const gap of data.gaps ?? state.catalog?.gaps ?? []) gaps.append(node('li', typeof gap === 'string' ? gap : gap.description ?? gap.reason ?? gap.title ?? JSON.stringify(gap)));
  if (!gaps.childElementCount) gaps.append(node('li', 'Chưa có kết quả rà soát pháp lý độc lập; tình trạng quyền và khả năng bảo hộ không được tự suy ra.'));
  body.append(gaps); showDialog('Phạm vi và dữ liệu sáng chế', body);
}

for (const view of views) $('tab-' + view).addEventListener('click', () => mode(view));
document.querySelector('.work-tabs').addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const enabled = views.filter(view => !$('tab-' + view).disabled);
  const current = enabled.indexOf(state.view);
  const next = event.key === 'Home' ? enabled[0] : event.key === 'End' ? enabled.at(-1) : enabled[(current + (event.key === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length];
  event.preventDefault(); mode(next); $('tab-' + next).focus();
});
$('search-form').addEventListener('submit', event => { event.preventDefault(); run('Đang tìm trong nguồn đã lưu…', async () => { const payload = { query: $('query').value.trim(), limit: 15 }; if ($('search-date').value) payload.asOf = $('search-date').value; if ($('search-jurisdiction').value) payload.jurisdiction = $('search-jurisdiction').value; state.search = await request('search', payload); renderResults(); }); });
document.querySelectorAll('[data-query]').forEach(b => b.addEventListener('click', () => { $('query').value = b.dataset.query; $('search-form').requestSubmit(); }));
$('browse-catalog').addEventListener('click', () => { state.search = null; renderResults(); });
$('catalog-kind').addEventListener('change', () => { state.catalogLimit = 10; renderResults(); });
$('case-example').addEventListener('click', () => { if (!discard()) return; run('Đang mở hồ sơ mẫu từ nguồn đã lưu…', async () => { const matter = await request('cases/example', { synthetic: true }); applyMatter(matter, 'matrix'); const url = new URL(location.href); url.searchParams.set('case', matter.id); history.pushState({}, '', url); }, state.status?.demo?.notice ?? 'Hồ sơ dùng nguồn công khai, tác vụ đối chiếu và quyết định duyệt là mô phỏng.'); });
$('new-case').addEventListener('click', createDialog); $('create-selected').addEventListener('click', createDialog);
$('case-filter').addEventListener('input', renderCases);
$('claim-text').addEventListener('input', () => { state.claimRecordId = null; setDirty('inputs'); renderEvidence(); }); $('claim-version').addEventListener('input', () => setDirty('inputs'));
$('case-notice-text').addEventListener('input', () => setDirty('inputs')); $('case-instructions-text').addEventListener('input', () => setDirty('inputs'));
document.querySelectorAll('[data-case-file]').forEach(b => b.addEventListener('click', () => pickText($(b.dataset.caseFile), () => setDirty('inputs'))));
$('save-inputs').addEventListener('click', saveInputs); $('save-selected').addEventListener('click', saveInputs);
$('add-row').addEventListener('click', () => addMatrixRow());
$('save-matrix').addEventListener('click', () => mutate('edit', { matrixRows: matrixPayload() }, 'Đã lưu ma trận. Các nhận định cần luật sư rà soát.'));
$('save-response').addEventListener('click', () => mutate('edit', { response: { text: $('response-text').value, evidenceIds: [...$('response-sources').querySelectorAll('input:checked')].map(input => input.value) } }, 'Đã lưu phần phản hồi để duyệt.'));
$('response-text').addEventListener('input', () => setDirty('response'));
for (const key of ['matrix', 'response']) { $('propose-' + key).addEventListener('click', () => propose([key])); $('approve-' + key).addEventListener('click', () => mutate('approve', { targets: [key] }, 'Đã duyệt phần đã chọn. Bản xuất được tạo khi đủ hai phần đã duyệt.')); }
$('task-form').addEventListener('submit', event => { event.preventDefault(); const targets = [...$('task-form').querySelectorAll('[name=target]:checked')].map(input => input.value); if (!targets.length) return notify('Chọn phần cần cập nhật trước khi giao việc.', true); propose(targets); });
$('task').addEventListener('keydown', event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); $('task-form').requestSubmit(); } });
$('export-latest').addEventListener('click', () => { const release = state.matter?.releases.at(-1); if (release) { const a = downloadLink(release.number); document.body.append(a); a.click(); a.remove(); } });
$('reload-case').addEventListener('click', () => { if (state.matter && discard()) openCase(state.matter.id); });
$('close-notice').addEventListener('click', () => { $('notice').hidden = true; });
$('dataset-details').addEventListener('click', datasetDialog); $('show-gaps').addEventListener('click', datasetDialog);
$('open-evidence').addEventListener('click', () => panel($('open-evidence').getAttribute('aria-expanded') !== 'true')); $('close-evidence').addEventListener('click', () => panel(false));
$('open-rail').addEventListener('click', () => rail(!$('rail').classList.contains('mobile-open')));
$('close-dialog').addEventListener('click', () => $('dialog').close());
$('sign-out').addEventListener('click', async () => { if (!discard()) return; try { const response = await fetch('/api/m5/session/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); if (!response.ok) throw Error('Chưa đăng xuất được. Thử lại khi dịch vụ sẵn sàng.'); location.reload(); } catch (error) { notify(error.message, true); } });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('dialog').open) { rail(false); if (mobile.matches) panel(false); } });
mobile.addEventListener('change', () => { rail(false); $('evidence-panel').hidden = false; panel(!mobile.matches); });
window.addEventListener('beforeunload', event => { if (isDirty()) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('popstate', () => { const id = new URL(location.href).searchParams.get('case'); if (id && id !== state.matter?.id && discard()) openCase(id); });

function today() { const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()); return ['year', 'month', 'day'].map(key => p.find(item => item.type === key).value).join('-'); }
$('search-date').value = today();
await run('Đang mở kho sáng chế…', async () => {
  const [status, catalog, cases] = await Promise.all([request('status'), request('catalog'), request('cases')]);
  state.status = status; state.catalog = catalog; state.cases = Array.isArray(cases) ? cases : cases.cases ?? [];
  $('coverage-summary').textContent = (status.dataset.sourceCount ?? catalog.sources.length) + ' nguồn, ' + (status.dataset.recordCount ?? catalog.records.length) + ' đoạn. Dựng kho ' + date(status.dataset.builtAt) + '. Chờ luật sư rà soát.';
  renderCases(); renderResults(); renderEvidence();
  const id = new URL(location.href).searchParams.get('case');
  if (id) applyMatter(await request('cases/' + encodeURIComponent(id)), 'matrix');
  panel(!mobile.matches);
});
