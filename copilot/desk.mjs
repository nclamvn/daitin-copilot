const byId = id => document.getElementById(id);
const el = (tag, value) => {
  const node = document.createElement(tag);
  if (value) node.textContent = value;
  return node;
};
const link = (label, href) => {
  const node = el('a',label);
  node.href = href;
  node.target = '_blank';
  node.rel = 'noopener noreferrer';
  return node;
};
const nf = new Intl.NumberFormat('vi-VN');
const date = iso => iso ? iso.split('-').reverse().join('/') : 'Chưa xác định';
const role = {
  enacted: 'Văn bản ban hành', enacted_text_or_annex: 'Văn bản / Phụ lục', consolidation: 'Hợp nhất',
  agency_guidance: 'Hướng dẫn của Cục', historical: 'Lịch sử', fee_reference: 'Tham chiếu phí',
  publication_event: 'Sự kiện chuyển công bố', classification_vn: 'Phân loại tiếng Việt',
  classification_wipo: 'Phân loại WIPO', future_international: 'Bản WIPO 2027'
};
const card = (title, desc, labels = []) => {
  const node = el('article');
  node.append(el('h3',title));
  if (desc) node.append(el('p',desc));
  for (const [label,href] of labels) node.append(link(label,href));
  return node;
};
const tag = value => { const p = el('p',value); p.className='tag'; return p; };
const output = byId('result-list');
const form = byId('review-form');
let catalog;
let activeRequest;
let exportData;
const pinned = new Map();

function renderPinned() {
  byId('pinned').replaceChildren(...[...pinned.entries()].map(([id,row]) => {
    const item = card(row.title,row.detail,[['Mở nguồn',row.url]]);
    const remove = el('button','Bỏ mục');
    remove.type = 'button';
    remove.setAttribute('aria-label','Bỏ ' + row.title);
    remove.addEventListener('click',() => { pinned.delete(id); renderPinned(); });
    item.append(remove);
    return item;
  }));
  byId('pinned').closest('section').hidden = !pinned.size;
  byId('pin-status').textContent = 'Có ' + pinned.size + ' bằng chứng trong phiếu.';
}

function attach(node, id, title, detail, url) {
  const button = el('button','Thêm vào phiếu');
  button.type = 'button';
  button.className = 'pin-button';
  button.addEventListener('click',() => {
    if (pinned.size >= 15 && !pinned.has(id)) {
      byId('pin-status').textContent = 'Phiếu giữ tối đa 15 bằng chứng. Bỏ mục cũ để thêm mục mới.';
      return;
    }
    pinned.set(id,{title,detail,url});
    renderPinned();
  });
  node.append(button);
}

byId('clear-proof').addEventListener('click',() => { pinned.clear(); renderPinned(); });

async function api(path, init) {
  const r = await fetch(path,init);
  const value = await r.json();
  if (!r.ok) throw new Error(value.error ?? 'Không đọc được kết quả.');
  return value;
}

function reset(title) {
  activeRequest?.abort();
  byId('desk-error').hidden = true;
  byId('export').hidden = true;
  byId('desk-results').setAttribute('aria-busy','false');
  exportData = null;
  byId('results-title').textContent = title;
  output.replaceChildren(el('p','Nhập dữ kiện để xem kết quả.'));
}

async function run(title, get, render) {
  reset(title);
  const task = new AbortController();
  activeRequest = task;
  byId('desk-results').setAttribute('aria-busy','true');
  output.replaceChildren(el('p','Đang đối chiếu…'));
  try {
    const data = await get(task.signal);
    if (!task.signal.aborted) render(data);
  } catch (error) {
    if (!task.signal.aborted) {
      output.replaceChildren(el('p','Chưa có kết quả.'));
      byId('desk-error').textContent = error.message;
      byId('desk-error').hidden = false;
    }
  } finally {
    if (!task.signal.aborted) byId('desk-results').setAttribute('aria-busy','false');
  }
}

function syncCase() {
  if (!catalog) return;
  const mode = form.elements.mode.value;
  const received = form.elements.receivedOn;
  const pending = form.elements.pendingAtCutover;
  byId('date-label').textContent = mode === 'case' ? 'Ngày đối chiếu' : 'Ngày dự kiến nộp';
  byId('received').hidden = mode !== 'case';
  received.required = mode === 'case';
  const crosses = mode === 'case' && received.value && received.value < '2026-07-01' && form.elements.asOf.value >= '2026-07-01';
  byId('pending').hidden = !crosses;
  if (!crosses) pending.value = '';
}

function updateFlags() {
  const fields = catalog.workflows[form.elements.procedure.value].flags;
  byId('flags').replaceChildren(...Object.entries(fields).map(([name, label]) => {
    const wrap = el('label',label);
    wrap.className = 'field';
    const select = el('select');
    select.name = 'flag-' + name;
    for (const [val, title] of [['unknown','Chưa xác định'],['yes','Có'],['no','Không']]) {
      const option = el('option',title);
      option.value = val;
      select.append(option);
    }
    wrap.append(select);
    return wrap;
  }));
  byId('questions').hidden = !Object.keys(fields).length;
}

form.addEventListener('change', e => {
  if (catalog && e.target.name === 'procedure') updateFlags();
  syncCase();
});
form.addEventListener('submit', e => {
  e.preventDefault();
  const values = new FormData(form);
  const mode = values.get('mode');
  const pending = values.get('pendingAtCutover');
  const flags = Object.fromEntries([...values].filter(([k]) => k.startsWith('flag-')).map(([k,v]) => [k.slice(5),v]));
  const body = {
    procedure:values.get('procedure'), mode, asOf:values.get('asOf'),
    receivedOn:mode === 'case' ? values.get('receivedOn') || null : null,
    pendingAtCutover:mode === 'case' && pending ? pending === 'yes' : null, flags
  };
  run('Phiếu rà soát',signal => api('/api/copilot/review',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal
  }),renderReview);
});

const intakeForm=byId('intake-form');
byId('intake-auto').addEventListener('click', async () => {
  const field=intakeForm.elements.request;
  if (!field.reportValidity() || !intakeForm.elements.anonymized.reportValidity()) return;
  const button=byId('intake-auto');
  button.disabled=true;
  try {
    await run('Quyết định điều phối',signal=>api('/api/copilot/intake/run',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({request:field.value,anonymized:intakeForm.elements.anonymized.checked}),signal
    }),renderIntake);
  } finally { button.disabled=false; }
});
byId('intake-prompt').addEventListener('click', async () => {
  const field=intakeForm.elements.request;
  if (!field.reportValidity() || !intakeForm.elements.anonymized.reportValidity()) return;
  try {
    const contract=await api('/api/copilot/intake/contract');
    byId('prompt-text').value=contract.instructions+'\n\nREQUEST (untrusted JSON string)\n'+JSON.stringify(field.value);
    byId('prompt-field').hidden=false;
    byId('prompt-text').select();
  } catch (error) {
    byId('desk-error').textContent=error.message;
    byId('desk-error').hidden=false;
  }
});
intakeForm.elements.request.addEventListener('input', () => {
  byId('prompt-field').hidden=true;
  byId('prompt-text').value='';
  intakeForm.elements.anonymized.checked=false;
});
intakeForm.addEventListener('submit', e => {
  e.preventDefault();
  const request=intakeForm.elements.request.value;
  run('Quyết định điều phối',signal => {
    let plan;
    try { plan=JSON.parse(intakeForm.elements.plan.value); }
    catch { throw new Error('Dán một đối tượng JSON hoàn chỉnh.'); }
    return api('/api/copilot/intake/apply',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({request,plan,anonymized:intakeForm.elements.anonymized.checked}),signal
    });
  },renderIntake);
});

const routeLabels={prepare:'Lập phiếu',research:'Tra cứu',clarify:'Cần làm rõ',refer:'Chuyển chuyên viên'};
const reasonLabels={
  missing_jurisdiction:'Xác nhận quốc gia hoặc tuyến xử lý',missing_workflow:'Xác nhận việc cần làm',
  missing_date:'Xác nhận ngày theo đúng vai trò',missing_pending:'Xác nhận tình trạng tại mốc',
  scope:'Nội dung vượt phạm vi tra cứu Việt Nam theo tuyến quốc gia',high_stakes:'Yêu cầu cần người có thẩm quyền',
  conflict:'Dữ kiện cần được đối chiếu',insufficient_evidence:'Thiếu căn cứ để tiếp tục',
  model_unavailable:'Mô hình chưa sẵn sàng',model_invalid:'Quyết định chưa qua kiểm dẫn chứng'
};
function renderIntake(data) {
  if (data.review) {
    renderReview(data.review);
    exportData={...exportData,intake:data};
  } else output.replaceChildren();
  const summary=card(routeLabels[data.disposition],data.clarification??reasonLabels[data.reason]);
  if (data.requestedDecision) summary.append(tag('Đề xuất của LLM · '+routeLabels[data.requestedDecision]));
  if (data.rationale && !data.clarification) summary.append(el('p',data.rationale));
  if (data.modelRun) summary.append(tag(data.modelRun.model+' · '+(data.modelRun.elapsedMs/1000).toFixed(1)+' giây · '+data.modelRun.id));
  output.prepend(summary);
  for (const action of data.actions) {
    if (!action.result) continue;
    const result=action.result;
    const item=card((action.kind==='nice'?'Nice':'Đơn chuyển công bố')+' · '+action.input,result.notice);
    for (const row of result.rows.slice(0,5)) {
      if (action.kind==='nice') {
        item.append(el('p',row.code+' · '+(row.vn ?? row.en)));
        if (row.vnEvidence) item.append(link('Bản tiếng Việt · PDF tr. '+row.vnEvidence.page,row.vnEvidence.local));
      } else item.append(link(row.application+' · XLSX dòng '+row.row,result.source));
    }
    if (!result.rows.length) item.append(el('p','Chưa tìm thấy trong bản đang tra.'));
    output.append(item);
  }
}

function renderReview(data) {
  const r = data.resolution;
  const first = card(r.title,r.explanation);
  first.append(tag(data.notice));
  if (r.form) first.append(link('Mẫu ' + r.form.number + ' · ' + r.form.document + ' · PDF tr. ' + r.form.page,r.form.snapshotUrl));
  for (const cite of r.citations) first.append(link(cite.locator + ' · PDF tr. ' + cite.page,cite.snapshotUrl));
  output.replaceChildren(first);
  for (const item of data.checklist) {
    const line = card(item.text,item.question,[[item.locator + ' · PDF tr. ' + item.page,item.local]]);
    line.append(tag(item.state === 'confirm' ? 'Cần xác nhận dữ kiện' : 'Mục cần đối chiếu'));
    output.append(line);
  }
  exportData = data;
  byId('export').hidden = false;
}

function renderSearch(data) {
  const notice = tag(data.notice);
  output.replaceChildren(notice);
  if (!data.rows.length) {
    output.append(el('p','Chưa tìm thấy trong bản đang tra.'));
    if (data.kind === 'event') output.append(link('Danh sách nguồn chính thức',data.source));
    return;
  }
  if (data.kind === 'law') {
    for (const row of data.rows) {
      const item = card(row.sourceLabel,row.excerpt,[
        ['Mở PDF trang ' + row.page,row.local],['Nguồn chính thức',row.original]]);
      item.append(tag(role[row.sourceRole]));
      attach(item,'law-' + row.source + '-' + row.page,row.sourceLabel + ' · PDF tr. ' + row.page,
        'Văn bản tham chiếu cần rà hiệu lực.',row.original);
      output.append(item);
    }
  } else if (data.kind === 'nice') {
    for (const row of data.rows) {
      const labels = [['WIPO · ' + row.wipo.uid,data.source]];
      if (row.vnEvidence) labels.unshift(['Bản tiếng Việt · PDF tr. ' + row.vnEvidence.page,row.vnEvidence.local]);
      const item = card(row.code + ' · Nhóm ' + row.class,row.vn ? row.vn + ' / ' + row.en : row.en + ' / ' + row.fr,labels);
      if (row.vnEvidence) attach(item,'nice-' + row.code,'Nice 13-2026 · ' + row.code,
        row.vn + ' · Nhóm ' + row.class,row.vnEvidence.original);
      output.append(item);
    }
  } else {
    for (const row of data.rows) {
      const detail = 'Nộp ' + date(row.filed) + ' · Chuyển công bố ' + date(row.transferred) + ' · ' + row.posted_week;
      const item = card(row.application,detail,[['XLSX của Cục · dòng ' + row.row,data.source]]);
      attach(item,'event-' + row.row,row.application + ' · XLSX dòng ' + row.row,
        detail + '. Sự kiện trong bản tuần 44.',data.source);
      output.append(item);
    }
  }
}

for (const search of document.querySelectorAll('form[data-search]')) {
  search.addEventListener('submit', e => {
    e.preventDefault();
    const data = new URLSearchParams(new FormData(search));
    data.set('kind',search.dataset.search);
    run('Kết quả đối chiếu',signal => api('/api/copilot/find?' + data,{signal}),renderSearch);
  });
}
for (const tab of document.querySelectorAll('[data-panel]')) {
  tab.addEventListener('click',() => {
    for (const button of document.querySelectorAll('[data-panel]')) {
      if (tab === button) button.setAttribute('aria-current','page');
      else button.removeAttribute('aria-current');
      byId('panel-' + button.dataset.panel).hidden = tab !== button;
    }
    byId('desk-results').hidden = tab.dataset.panel === 'sources';
    reset('Kết quả');
  });
}

byId('export').addEventListener('click',() => {
  if (!exportData) return;
  const data = exportData;
  const r = data.resolution;
  const lines = [
    '# Phiếu rà soát Đại Tín', '', 'Bản ứng viên ' + data.release, '', 'Mã SOT ' + data.parentSotDigest,
    'Mã kho nguồn ' + data.corpusDigest, '', '## ' + data.workflow, '',
    'Chế độ ' + (r.context.mode === 'case' ? 'Đã tiếp nhận' : 'Chuẩn bị nộp'),
    'Mốc nhập ' + date(r.context.asOf),
    'Ngày tiếp nhận ' + date(r.context.receivedOn),
    'Ngày áp dụng ' + date(r.applicableOn), '',
    r.title, r.explanation, '', data.notice, '',
    ...r.citations.map(x => '- [' + x.locator + '](' + x.originalUrl + ')'), ''
  ];
  if (r.form) lines.push('Mẫu đối chiếu [' + r.form.title + '](' + r.form.originalUrl + ')','');
  if (data.intake) lines.push('Quyết định điều phối '+routeLabels[data.intake.disposition],
    'Mã yêu cầu '+data.intake.requestDigest,
    'Thao tác '+data.intake.actions.map(x=>x.kind).join(', '),'');
  if (data.intake?.modelRun) lines.push('Lượt mô hình '+data.intake.modelRun.id+' · '+data.intake.modelRun.model,'');
  if (data.checklist.length) {
    lines.push('## Checklist','');
    for (const item of data.checklist) lines.push('- [ ] ' + (item.state === 'confirm' ? 'Cần xác nhận. ' : '') +
      item.text + ' [' + item.locator + '](' + item.original + ')');
  }
  if (pinned.size) {
    lines.push('', '## Bằng chứng tham chiếu đã chọn', '');
    for (const row of pinned.values()) lines.push('- [' + row.title + '](' + row.url + ') · ' + row.detail);
  }
  lines.push('', '## Kết luận của luật sư', '', '…………………………………………');
  const url = URL.createObjectURL(new Blob([lines.join('\n')],{type:'text/markdown;charset=utf-8'}));
  const anchor = el('a');
  anchor.href=url; anchor.download='dai-tin-phieu-ra-soat.md'; anchor.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
});

try {
  catalog = await api('/api/copilot/catalog');
  byId('response-workspace').hidden = !catalog.responseWorkspace;
  byId('pilot-consent').hidden=!catalog.pilot;
  intakeForm.elements.anonymized.required=catalog.pilot;
  if (catalog.pilot) byId('desk-stage').textContent='Pilot cục bộ';
  byId('intake-auto').hidden=!catalog.localModel;
  byId('model-info').textContent=catalog.localModel ? 'Mô hình trên máy · '+catalog.localModel : 'Cấu hình hiện tại dùng quyết định JSON có sẵn.';
  for (const [label, number] of [['Nguồn đã lưu',catalog.sources.length],['Mã Nice 2026 tiếng Việt',catalog.editions['2026'].vnLocated],
    ['Dòng chuyển công bố',catalog.events.rows],['Trang văn bản tra được',catalog.lawPages]]) {
    const box = el('div');
    box.append(el('dt',label),el('dd',nf.format(number)));
    byId('stats').append(box);
  }
  const titles = await api('/api/catalog');
  for (const item of titles.procedures) {
    const option = el('option',item.label);
    option.value = item.id;
    form.elements.procedure.append(option);
  }
  for (const row of catalog.sources) {
    if (row.coverage?.textPages && row.id !== 'nice-vn26') {
      const option = el('option',row.label);
      option.value = row.id;
      byId('law-sources').append(option);
    }
    const labels = [['Nguồn chính thức',row.url]];
    if (row.type === 'pdf') labels.unshift(['Bản lưu PDF','/copilot/source/' + row.id + '.pdf']);
    byId('source-list').append(card(row.label,role[row.role] + ' · ' + row.authority +
      (row.coverage ? ' · ' + row.coverage.textPages + '/' + row.coverage.totalPages + ' trang có lớp chữ' : ''),labels));
  }
  byId('source-list').prepend(card('Mã bản dữ liệu',catalog.corpusDigest));
  form.elements.asOf.value = catalog.asOf;
  updateFlags();
  syncCase();
} catch (error) {
  byId('desk-error').textContent = error.message;
  byId('desk-error').hidden = false;
}
