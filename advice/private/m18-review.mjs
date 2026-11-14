const fields = {
  correct: 'Đúng câu hỏi, thủ tục và dữ kiện',
  conditions: 'Giữ điều kiện áp dụng và biết dừng khi thiếu căn cứ',
  evidence: 'Dẫn đúng đoạn và phiên bản nguồn',
  usable: 'Bản cuối dùng được và đúng người nhận',
  critical: 'Có lỗi nghiêm trọng',
};
const file = document.getElementById('blind-file');
const section = document.getElementById('blind-submission');
const status = document.getElementById('blind-status');
let submissions = [];
const decisions = new Map();

const node = (tag, text) => {
  const element = document.createElement(tag);
  if (text != null) element.textContent = text;
  return element;
};
const button = (text, run) => {
  const control = node('button', text);
  control.type = 'button';
  control.addEventListener('click', run);
  return control;
};
const text = value => typeof value === 'string' ? value : JSON.stringify(value, null, 2);

function render(index) {
  const row = submissions[index];
  const prior = decisions.get(row.code);
  const heading = node('h2', row.caseId + ' · ' + row.code);
  const options = node('select');
  options.setAttribute('aria-label', 'Bản đang chấm');
  for (const [i, entry] of submissions.entries()) {
    const option = node('option', entry.code + (decisions.has(entry.code) ? ' · Đã chấm' : ''));
    option.value = i;
    options.append(option);
  }
  options.value = index;
  options.addEventListener('change', () => render(Number(options.value)));
  const card = node('div'); card.className = 'panel';
  card.append(heading);
  for (const [label, value] of [['Câu hỏi và diễn biến', row.caseMaterial?.question], ['Nguồn để đối chiếu', row.caseMaterial?.sources],
    ['Căn cứ được dẫn trong bản cuối', row.evidence], ['Thư trả lời khách', row.client], ['Thư cần xác nhận', row.partner]]) {
    if (!value || Array.isArray(value) && !value.length) continue;
    const block = node('details');
    block.open = label !== 'Nguồn để đối chiếu';
    const content = node('p', Array.isArray(value) ? value.map(text).join('\n\n') : text(value));
    block.append(node('summary', label), content);
    card.append(block);
  }
  const form = node('form'); form.className = 'panel';
  const inputs = new Map();
  for (const [id, label] of Object.entries(fields)) {
    const wrap = node('label', label);
    const select = node('select');
    select.setAttribute('aria-label', label);
    for (const [value, copy] of [['', 'Chọn'], ['true', id === 'critical' ? 'Có' : 'Đạt'], ['false', id === 'critical' ? 'Không' : 'Trượt']]) {
      const opt = node('option', copy);
      opt.value = value;
      select.append(opt);
    }
    select.required = true;
    select.value = prior ? String(prior[id]) : '';
    inputs.set(id, select);
    wrap.append(select);
    form.append(wrap);
  }
  const label = node('label', 'Lý do hoặc đoạn cần sửa');
  const note = node('textarea');
  note.value = prior?.note ?? '';
  label.append(note);
  const save = node('button', 'Lưu điểm');
  save.className = 'primary';
  form.append(label, save);
  form.addEventListener('submit', event => {
    event.preventDefault();
    const record = { code: row.code, ...Object.fromEntries([...inputs].map(([id, control]) => [id, control.value === 'true'])),
      note: note.value.trim() };
    if ((record.critical || !record.correct || !record.conditions || !record.evidence || !record.usable) && !record.note) {
      status.textContent = 'Ghi lý do cho mục trượt hoặc lỗi nghiêm trọng.';
      note.focus();
      return;
    }
    decisions.set(row.code, record);
    sessionStorage.setItem(section.dataset.receipt, JSON.stringify([...decisions.values()]));
    const next = submissions.findIndex(entry => !decisions.has(entry.code));
    render(next < 0 ? index : next);
  });
  const download = button('Tải kết quả chấm', () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify([...decisions.values()], null, 2) + '\n'], { type: 'application/json' }));
    const link = node('a');
    link.href = url;
    link.download = 'phieu-da-cham.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  download.disabled = decisions.size !== submissions.length;
  status.textContent = 'Đã chấm ' + decisions.size + '/' + submissions.length + ' bản.';
  section.replaceChildren(options, card, form, download);
}

file.addEventListener('change', async () => {
  if (!file.files.length) return;
  try {
    const { submissions: rows } = JSON.parse(await file.files[0].text());
    if (!Array.isArray(rows) || !rows.length || rows.length > 24 || new Set(rows.map(row => row.code)).size !== rows.length ||
        rows.some(row => typeof row.code !== 'string' || !row.caseMaterial?.question || !row.caseMaterial?.sources ||
          ['arm', 'activeMs', 'waitMs'].some(field => Object.hasOwn(row, field)))) throw new Error();
    submissions = rows;
    decisions.clear();
    const key = 'daitin:m18-review:v1:' + submissions.map(row => row.code).sort().join(',');
    const stored = JSON.parse(sessionStorage.getItem(key) ?? '[]');
    for (const row of stored) if (submissions.some(item => item.code === row.code)) decisions.set(row.code, row);
    section.dataset.receipt = key;
    render(0);
  } catch {
    status.textContent = 'Chọn phiếu chấm mù có dữ kiện và nguồn đi kèm.';
  }
});
