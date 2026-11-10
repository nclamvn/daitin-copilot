const fields = {
  application: 'Số đơn', title: 'Tên nhãn hiệu', receivedOn: 'Ngày cơ quan tiếp nhận đơn',
  noticeNumber: 'Số thông báo', noticeDate: 'Ngày thông báo', deadline: 'Hạn phản hồi ghi trên thông báo'
};
const dates = new Set(['receivedOn', 'noticeDate', 'deadline']);
const limit = 4 * 1024 * 1024;

function element(tag, text, style) {
  const item = document.createElement(tag);
  if (text !== undefined) item.textContent = text;
  if (style) item.className = style;
  return item;
}

function action(text, handler) {
  const item = element('button', text, 'quiet small');
  item.type = 'button';
  item.addEventListener('click', handler);
  return item;
}

async function post(path, body) {
  const res = await fetch('/api/m4/' + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Chưa đọc được PDF.');
  return res;
}

export function createPDFIntake({ intake, run, message }) {
  const panel = document.getElementById('pdf-intake');
  const notice = intake.elements.notice;
  let state;
  let previewUrl;
  let epoch = 0;
  let page = 1;
  let anchors = [];
  let optional = {};
  let verified = false;
  let shown;
  let accepted = {};

  function reset(clear = false) {
    epoch += 1;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = undefined;
    if (state && clear) notice.value = '';
    state = undefined;
    page = 1;
    anchors = [];
    optional = {};
    accepted = {};
    verified = false;
    notice.readOnly = false;
    panel.hidden = true;
    panel.replaceChildren();
  }

  function updateNotice() {
    notice.value = anchors.map(item => item.text).join('\n\n');
    verified = false;
  }

  async function showPage(number) {
    if (!state) return;
    page = number;
    render();
    const request = state;
    try {
      const result = await post('pdf/page', { content: request.content, anonymized: true, sha256: request.sha256, page: number });
      const blob = await result.blob();
      if (request !== state || page !== number) return;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(blob);
      shown.src = previewUrl;
      shown.hidden = false;
      panel.querySelector('.pdf-image-status').hidden = true;
    } catch (error) {
      if (request === state && page === number) panel.querySelector('.pdf-image-status').textContent = error.message;
    }
  }

  function pushAnchor(mode, text) {
    const clean = text.trim();
    if (!clean) return message('Chọn hoặc nhập đoạn cần đưa vào bản nháp.', true);
    if (anchors.length === 3 || [...anchors.map(item => item.text), clean].join('\n\n').length > 1100) {
      return message('Chọn tối đa ba đoạn, tổng cộng không quá 1.100 ký tự.', true);
    }
    if (anchors.some(item => item.page === page && item.text === clean)) return message('Đoạn này đã được chọn.', true);
    anchors.push({ page, text: clean, mode });
    updateNotice();
    render();
  }

  function render() {
    if (!state) return;
    const head = element('div', undefined, 'pdf-head');
    head.append(element('h3', 'Đối chiếu PDF'), action('Bỏ PDF', () => reset(true)));
    const name = element('p', state.label + ' · ' + state.pages.length + ' trang', 'pdf-name');
    const grid = element('div', undefined, 'pdf-grid');
    const imageBox = element('div', undefined, 'pdf-page-view');
    const select = element('select');
    select.setAttribute('aria-label', 'Trang PDF');
    for (const item of state.pages) {
      const option = element('option', 'Trang ' + item.page + (item.text ? '' : ' · Chưa có lớp chữ'));
      option.value = item.page;
      option.selected = item.page === page;
      select.append(option);
    }
    select.addEventListener('change', () => showPage(Number(select.value)));
    const prior = panel.querySelector('img');
    shown = element('img');
    shown.alt = 'Ảnh trang ' + page + ' của thông báo';
    const reuse = prior?.dataset.page === String(page) && prior.src && !prior.hidden;
    shown.dataset.page = String(page);
    shown.hidden = !reuse;
    if (reuse) shown.src = prior.src;
    const imageState = element('p', 'Đang mở ảnh trang…', 'pdf-image-status');
    imageState.hidden = reuse;
    imageBox.append(select, imageState, shown);

    const extract = element('div', undefined, 'pdf-extract');
    const current = state.pages[page - 1];
    const text = element('textarea');
    text.readOnly = true;
    text.rows = 8;
    text.value = current.text;
    text.setAttribute('aria-label', 'Văn bản trang PDF');
    if (current.text) extract.append(element('h4', 'Chọn đoạn làm nguồn'), text,
      action('Dùng đoạn đã bôi chọn', () => pushAnchor('text', text.value.slice(text.selectionStart, text.selectionEnd))),
      action('Dùng toàn bộ trang', () => pushAnchor('text', text.value)));
    else extract.append(element('p', 'Trang này chưa có lớp văn bản. Đọc ảnh trang và nhập đoạn bằng tay.'));
    const manual = element('details');
    manual.append(element('summary', 'Nhập đoạn bằng tay theo trang này'));
    const manualText = element('textarea');
    manualText.rows = 4;
    manualText.maxLength = 1100;
    manualText.setAttribute('aria-label', 'Đoạn nhập tay theo trang');
    manual.append(manualText, action('Lưu đoạn nhập tay', () => pushAnchor('manual', manualText.value)));
    extract.append(manual);
    const list = element('ul');
    for (const [index, item] of anchors.entries()) {
      const row = element('li');
      row.append('Trang ' + item.page + (item.mode === 'manual' ? ' · Nhập tay' : ' · Đoạn trích'), ' ',
        action('Bỏ đoạn ' + (index + 1), () => { anchors.splice(index, 1); updateNotice(); render(); }));
      list.append(row);
    }
    extract.append(list);
    const ledger = element('div', undefined, 'pdf-facts');
    ledger.append(element('h4', 'Dữ kiện đối chiếu'), element('p', 'Gợi ý lấy từ nhãn trên trang. Chọn giá trị sau khi xem bản gốc. Hạn phản hồi chỉ ghi theo thông báo.'));
    for (const [key, label] of Object.entries(fields)) {
      const row = element('div', undefined, 'pdf-fact');
      row.append(element('strong', label));
      const suggestions = state.fields[key];
      const values = [...new Set(suggestions.map(item => item.value))];
      if (values.length > 1) row.append(element('p', 'Có nhiều giá trị trong tài liệu.', 'pdf-warning'));
      if (!suggestions.length) row.append(element('p', 'Chưa thấy giá trị theo nhãn. Xác nhận tay nếu có.', 'pdf-warning'));
      const input = intake.elements[key] ?? element('input');
      if (!intake.elements[key]) {
        input.type = dates.has(key) ? 'date' : 'text';
        input.maxLength = 100;
        input.value = optional[key] ?? '';
        input.setAttribute('aria-label', label);
        input.addEventListener('input', () => { optional[key] = input.value; delete accepted[key]; invalidate(); });
        row.append(input);
      } else row.append(element('p', 'Giá trị được điền ở thông tin hồ sơ phía trên.'));
      const options = element('div', undefined, 'pdf-options');
      for (const item of suggestions) {
        const pick = action(item.value + ' · Trang ' + item.page, () => {
          input.value = item.value;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          accepted[key] = { value: item.value, page: item.page };
          invalidate();
          for (const choice of options.children) choice.setAttribute('aria-pressed', String(choice === pick));
        });
        pick.title = item.line;
        pick.setAttribute('aria-pressed', String(accepted[key]?.page === item.page && accepted[key]?.value === item.value));
        options.append(pick);
      }
      row.append(options);
      ledger.append(row);
    }
    const confirm = element('label', undefined, 'check');
    const check = element('input');
    check.type = 'checkbox';
    check.checked = verified;
    check.id = 'pdf-confirm';
    check.addEventListener('change', () => { verified = check.checked; });
    confirm.append(check, ' Tôi đã kiểm tra trang gốc, các đoạn nguồn và dữ kiện của hồ sơ.');
    const review = element('div', undefined, 'pdf-review');
    review.append(extract, ledger, confirm);
    grid.append(imageBox, review);
    panel.replaceChildren(head, name, grid);
  }

  function invalidate() {
    verified = false;
    const check = panel.querySelector('#pdf-confirm');
    if (check) check.checked = false;
  }

  intake.addEventListener('input', event => {
    if (!state) return;
    if (event.target.name === 'title' || event.target.name === 'receivedOn') delete accepted[event.target.name];
    if (event.target !== panel.querySelector('#pdf-confirm')) invalidate();
  });

  return {
    hasPDF: () => Boolean(state),
    reset,
    open(file) {
      if (!intake.elements.anonymized.checked) return message('Xác nhận quyền dùng dữ liệu pilot trước khi đọc PDF.', true);
      if (file.size > limit || file.name.length > 90) return message('Chọn PDF tối đa 4 MiB, tên tệp tối đa 90 ký tự.', true);
      return run('Đang đọc PDF theo từng trang…', async () => {
        const expected = epoch;
        const content = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result.split(',')[1]);
          reader.onerror = () => reject(new Error('Chưa đọc được tệp từ máy.'));
          reader.readAsDataURL(file);
        });
        const result = await (await post('pdf', { content, anonymized: true })).json();
        if (expected !== epoch) return;
        reset(true);
        state = { ...result, label: file.name, content };
        notice.value = '';
        notice.readOnly = true;
        panel.hidden = false;
        await showPage(1);
        panel.scrollIntoView({ block: 'start' });
        return result.pages.some(item => !item.text)
          ? 'Có trang chưa có lớp chữ. Đối chiếu ảnh và nhập đoạn bằng tay nếu cần.'
          : 'Đã đọc PDF. Chọn đoạn nguồn và xác nhận dữ kiện.';
      });
    },
    payload() {
      if (!state) return null;
      if (!verified || !anchors.length) throw new Error('Chọn đoạn nguồn và xác nhận PDF trước khi lưu hồ sơ.');
      return {
        content: state.content,
        pdf: { label: state.label, sha256: state.sha256, anchors, verified, fields: optional, accepted }
      };
    }
  };
}
