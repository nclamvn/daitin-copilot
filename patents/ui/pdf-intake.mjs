const roles = [
  ['notice', 'Thông báo cần phản hồi'],
  ['claim', 'Yêu cầu bảo hộ đang xét'],
  ['d1', 'Tài liệu đối chứng D1']
];
const maxBytes = 2 * 1024 * 1024;

function element(tag, text = '', className) {
  const result = document.createElement(tag);
  result.textContent = text;
  if (className) result.className = className;
  return result;
}

function action(text, handler, className = 'quiet') {
  const result = element('button', text, className);
  result.type = 'button';
  result.addEventListener('click', handler);
  return result;
}

function field(text, value, { tag = 'input', type, required, maxLength } = {}) {
  const label = element('label', text);
  const input = element(tag);
  input.value = value;
  if (type) input.type = type;
  if (required) input.required = true;
  if (maxLength) input.maxLength = maxLength;
  label.append(input);
  return { label, input };
}

export async function base64Pdf(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
  }
  return btoa(chunks.join(''));
}

function exactSelection(input) {
  const text = input.value.slice(input.selectionStart, input.selectionEnd);
  const start = input.selectionStart + text.length - text.trimStart().length;
  return { start, end: start + text.trim().length, text: text.trim() };
}

export function selectPdfExcerpt(text, limit, onRead, initialSelection) {
  const extracted = field('Chọn đoạn nguyên văn trong văn bản trích', text, { tag: 'textarea' });
  extracted.input.rows = 9;
  extracted.input.readOnly = true;
  extracted.input.className = 'pdf-extracted';
  if (initialSelection) extracted.input.setSelectionRange(initialSelection.start, initialSelection.end);
  const status = element('p', '', 'pdf-selection-count');
  const excerpt = element('pre', '', 'pdf-excerpt');
  excerpt.setAttribute('aria-label', 'Đoạn sẽ lưu nguyên văn');
  let selection = exactSelection(extracted.input);
  function read() {
    const next = exactSelection(extracted.input);
    const changed = next.start !== selection.start || next.end !== selection.end;
    selection = next;
    const size = selection.text.length;
    const valid = size > 0 && size <= limit;
    status.textContent = size
      ? size.toLocaleString('vi-VN') + ' ký tự đã chọn' + (valid ? '.' : '. Chọn đoạn ngắn hơn, tối đa ' + limit.toLocaleString('vi-VN') + ' ký tự.')
      : 'Chưa chọn đoạn.';
    excerpt.hidden = !valid;
    excerpt.textContent = valid ? selection.text : '';
    onRead(selection, valid, changed);
    return selection;
  }
  const all = action('Chọn toàn bộ văn bản trang', () => {
    extracted.input.focus();
    extracted.input.select();
    read();
  }, 'text-button');
  for (const event of ['select', 'keyup', 'pointerup']) extracted.input.addEventListener(event, read);
  return { elements: [extracted.label, all, status, excerpt], read };
}

function filePicker(label, text, multiple, onFiles) {
  const control = element('div', '', 'pdf-file-control');
  const input = element('input');
  input.type = 'file';
  input.accept = '.pdf,application/pdf';
  input.multiple = multiple;
  input.setAttribute('aria-label', label);
  input.addEventListener('change', () => {
    const files = [...input.files];
    input.value = '';
    if (files.length) onFiles(files);
  });
  const visible = element('span', text);
  visible.setAttribute('aria-hidden', 'true');
  control.append(input, visible);
  return control;
}

function dropFiles(zone, onFiles) {
  zone.addEventListener('dragover', event => {
    event.preventDefault();
    zone.classList.add('dragging');
  });
  zone.addEventListener('dragleave', event => {
    if (!zone.contains(event.relatedTarget)) zone.classList.remove('dragging');
  });
  zone.addEventListener('drop', event => {
    event.preventDefault();
    zone.classList.remove('dragging');
    const files = [...(event.dataTransfer?.files ?? [])];
    if (files.length) onFiles(files);
  });
}

function pageInput(text) {
  const fieldValue = field(text, '1', { type: 'number', required: true });
  fieldValue.input.min = 1;
  fieldValue.input.max = 12;
  fieldValue.input.step = 1;
  return fieldValue;
}

function isPdf(file) {
  return /\.pdf$/i.test(file.name) && file.size > 0 && file.size <= maxBytes;
}

function validReceipt(receipt, slot) {
  return receipt?.role === slot.role && /^[a-f0-9]{64}$/.test(receipt.sha256) &&
    Number.isInteger(receipt.pageCount) && Number.isInteger(receipt.maxExcerptChars) &&
    Array.isArray(receipt.pages) && receipt.pages.length === Number(slot.last.input.value) - Number(slot.first.input.value) + 1 &&
    receipt.pages.every((page, index) => page.page === Number(slot.first.input.value) + index && typeof page.text === 'string');
}

function setStatus(status, text = '', error = false) {
  status.textContent = text;
  status.hidden = !text;
  status.toggleAttribute('data-error', error);
}

export function pdfPackIntake({ dialog, request, run, today, onCreated, onManual }) {
  const container = element('div', '', 'pack-intake');
  const prepare = element('form', '', 'pack-prepare');
  const review = element('form', '', 'pack-review');
  review.hidden = true;
  const draftStatus = element('p', '', 'pdf-notice');
  const reviewStatus = element('p', '', 'pdf-notice');
  for (const status of [draftStatus, reviewStatus]) {
    status.hidden = true;
    status.setAttribute('role', 'status');
  }
  const ref = field('Mã hồ sơ', '', { required: true, maxLength: 48 });
  ref.input.placeholder = 'PAT-2026-001';
  const title = field('Tên hồ sơ', '', { required: true, maxLength: 160 });
  const asOf = field('Ngày đối chiếu', today(), { type: 'date', required: true });
  const instructions = field('Chỉ dẫn nghiệp vụ', '', { tag: 'textarea', required: true, maxLength: 6000 });
  instructions.input.rows = 3;
  instructions.input.placeholder = 'Ví dụ: lập ma trận yêu cầu 1 và chuẩn bị phản hồi về điểm chưa được D1 mô tả.';
  const metadata = () => ({
    reference: ref.input.value.trim(), title: title.input.value.trim(),
    jurisdiction: 'VN', asOf: asOf.input.value, instructionsText: instructions.input.value.trim()
  });
  const grid = element('div', '', 'pack-metadata');
  grid.append(ref.label, asOf.label, title.label);
  const synthetic = field('Tôi xác nhận ba PDF là tài liệu mô phỏng.', '', { type: 'checkbox', required: true });
  synthetic.label.className = 'check pack-confirm-synthetic';
  synthetic.label.prepend(synthetic.input);

  const slots = roles.map(([role, title]) => {
    const row = element('li', '', 'pack-slot');
    const first = pageInput('Từ trang');
    const last = pageInput('Đến trang');
    const fileName = element('p', 'Chưa chọn tệp', 'pack-file-name');
    return { role, title, row, first, last, fileName, file: null };
  });
  const retained = new Map();
  const roleList = element('ul', '', 'pack-role-list');
  function updateSlot(slot, file, from = 1, to = 1) {
    retained.delete(slot.role);
    slot.file = file;
    slot.first.input.value = from;
    slot.last.input.value = to;
    slot.fileName.textContent = file ? file.name : 'Chưa chọn tệp';
    slot.row.toggleAttribute('data-file', Boolean(file));
    synthetic.input.checked = false;
    setStatus(draftStatus);
  }
  function assignOne(slot, files) {
    if (files.length !== 1 || !isPdf(files[0])) {
      setStatus(draftStatus, 'Chọn một tệp PDF mô phỏng, tối đa 2 MiB.', true);
      return;
    }
    updateSlot(slot, files[0]);
  }
  for (const slot of slots) {
    const label = element('div', '', 'pack-slot-title');
    label.append(element('strong', slot.title), slot.fileName);
    const range = element('div', '', 'pack-slot-range');
    range.append(slot.first.label, slot.last.label);
    for (const input of [slot.first.input, slot.last.input]) {
      input.addEventListener('input', () => retained.delete(slot.role));
    }
    const controls = element('div', '', 'pack-slot-actions');
    const pick = filePicker('Chọn PDF cho ' + slot.title, 'Chọn tệp', false, files => assignOne(slot, files));
    const swap = element('select');
    swap.setAttribute('aria-label', 'Đổi tệp của ' + slot.title + ' với vai trò khác');
    swap.append(element('option', 'Đổi vị trí'));
    swap.options[0].value = '';
    for (const other of slots.filter(item => item !== slot)) {
      const option = element('option', other.title);
      option.value = other.role;
      swap.append(option);
    }
    swap.addEventListener('change', () => {
      const other = slots.find(item => item.role === swap.value);
      swap.value = '';
      if (!other) return;
      const previous = [slot.file, slot.first.input.value, slot.last.input.value];
      updateSlot(slot, other.file, other.first.input.value, other.last.input.value);
      updateSlot(other, ...previous);
    });
    controls.append(pick, swap);
    slot.row.append(label, range, controls);
    roleList.append(slot.row);
  }

  const zone = element('div', '', 'pdf-drop pack-drop');
  function assignBatch(files) {
    if (files.length !== 3 || !files.every(isPdf) || files.reduce((sum, file) => sum + file.size, 0) > maxBytes) {
      setStatus(draftStatus, 'Chọn đủ 3 tệp PDF, tổng dung lượng tối đa 2 MiB. Có thể chọn từng tệp theo vai trò bên dưới.', true);
      return;
    }
    files.forEach((file, index) => updateSlot(slots[index], file));
  }
  zone.append(element('strong', 'Thả 3 PDF vào đây'), filePicker('Chọn 3 PDF cùng lúc', 'Chọn 3 PDF', true, assignBatch));
  dropFiles(zone, files => { if (!readButton.disabled) assignBatch(files); });
  const readButton = element('button', 'Đọc 3 tài liệu', 'primary');
  readButton.type = 'submit';
  const actions = element('div', '', 'pack-actions');
  actions.append(
    action('Tạo hồ sơ trống hoặc nhập tay', () => onManual(metadata()), 'text-button'),
    readButton
  );
  prepare.append(zone, element('p', 'Tổng dung lượng tối đa 2 MiB. Mỗi PDF tối đa 12 trang, đọc 1–4 trang liên tiếp. Khi chọn cả bộ, kiểm lại thứ tự tệp theo vai trò bên dưới.', 'pack-help'),
    roleList, grid, instructions.label, synthetic.label, draftStatus, actions);

  const saveButton = element('button', 'Lưu hồ sơ và 3 tài liệu', 'primary');
  saveButton.type = 'submit';
  const confirmedCount = element('p', '', 'pack-confirmed-count');
  confirmedCount.setAttribute('aria-live', 'polite');
  const reviewCards = element('div', '', 'pack-review-cards');
  const reviewTitle = element('h3', 'Đối chiếu đoạn sẽ lưu');
  reviewTitle.tabIndex = -1;
  const reviewActions = element('div', '', 'pack-actions');
  const back = action('Đổi tệp, vai trò hoặc trang', () => {
    const next = batch.find(item => !item.confirmed)?.slot ?? slots[0];
    retained.clear();
    for (const item of batch) {
      if (!item.valid || !item.confirmed || !item.label.trim()) continue;
      retained.set(item.role, {
        file: item.slot.file, sha256: item.receipt.sha256, firstPage: item.firstPage, lastPage: item.lastPage,
        page: item.page, label: item.label, selection: { ...item.selection }
      });
    }
    clearReview();
    review.hidden = true;
    prepare.hidden = false;
    next.first.input.focus();
  }, 'text-button');
  reviewActions.append(back, confirmedCount, saveButton);
  review.append(reviewTitle, element('p', 'Với mỗi vai trò, mở ảnh trang hoặc bản PDF gốc, chọn đoạn nguyên văn rồi xác nhận.', 'pack-help'),
    reviewCards, reviewStatus, reviewActions);

  let batch = [];
  let savingUncertain = false;
  function revoke(item) {
    if (item.preview) URL.revokeObjectURL(item.preview);
    item.preview = null;
  }
  function clearReview() {
    batch.forEach(revoke);
    batch = [];
    savingUncertain = false;
    reviewCards.replaceChildren();
    setStatus(reviewStatus);
  }
  function updateConfirmations() {
    const count = batch.filter(item => item.valid && item.confirmed && item.label?.trim()).length;
    confirmedCount.textContent = count + '/3 đoạn đã xác nhận';
    const disabled = count !== slots.length || savingUncertain;
    saveButton.dataset.keepDisabled = String(disabled);
    saveButton.disabled = disabled;
    if (savingUncertain) {
      back.dataset.keepDisabled = 'true';
      back.disabled = true;
    }
  }
  async function perform(status, label, task, onError) {
    await run(label, async () => {
      setStatus(status, label);
      try { await task(); }
      catch (error) {
        if (onError) onError(error);
        const text = error.status === 401 ? 'Phiên đăng nhập đã hết. Đăng nhập lại để tiếp tục.' : error.message;
        setStatus(status, text, true);
      }
    });
  }

  function renderDocument(item, body, summary) {
    body.replaceChildren();
    const pageLabel = element('label', 'Trang để đối chiếu');
    const select = element('select');
    for (const page of item.receipt.pages) {
      const option = element('option', 'Trang ' + page.page + (page.usable ? '' : ' · Thiếu lớp chữ'));
      option.value = String(page.page);
      select.append(option);
    }
    select.value = String(item.page);
    select.setAttribute('aria-label', 'Trang để đối chiếu của ' + item.slot.title);
    select.addEventListener('change', () => {
      revoke(item);
      item.page = Number(select.value);
      item.confirmed = false;
      item.valid = false;
      item.selection = null;
      renderDocument(item, body, summary);
      body.querySelector('select')?.focus();
    });
    pageLabel.append(select);

    const picture = element('div', '', 'pdf-page-preview');
    const preview = action('Xem ảnh trang ' + item.page, () => {
      if (item.preview) {
        picture.hidden = !picture.hidden;
        preview.textContent = (picture.hidden ? 'Xem ảnh trang ' : 'Ẩn ảnh trang ') + item.page;
        return;
      }
      perform(reviewStatus, 'Đang dựng ảnh trang…', async () => {
        const bytes = await request('pdf-pack/preview', {
          synthetic: true, content: item.content, sha256: item.receipt.sha256, page: item.page
        }, true);
        item.preview = URL.createObjectURL(bytes);
        const image = element('img');
        image.alt = 'Ảnh trang ' + item.page + ' của ' + item.slot.file.name;
        image.src = item.preview;
        picture.replaceChildren(image);
        picture.hidden = false;
        preview.textContent = 'Ẩn ảnh trang ' + item.page;
        setStatus(reviewStatus);
      });
    });
    const toolbar = element('div', '', 'pack-page-tools');
    toolbar.append(pageLabel, preview);
    body.append(toolbar, picture);
    const page = item.receipt.pages.find(value => value.page === item.page);
    if (!page.usable || !page.text.trim()) {
      body.append(element('p', 'Trang này thiếu lớp chữ. Chọn trang khác hoặc quay lại thay PDF.', 'pdf-notice'));
      summary.textContent = 'Chọn trang có văn bản';
      updateConfirmations();
      return;
    }

    const name = field('Tên tài liệu lưu trong hồ sơ', item.label, { required: true, maxLength: 90 });
    const accept = field('Tôi đã kiểm tra vai trò và đối chiếu đoạn chọn với trang gốc.', '', { type: 'checkbox' });
    accept.label.className = 'check pdf-attestation';
    accept.label.prepend(accept.input);
    function update() {
      accept.input.dataset.keepDisabled = String(!item.valid);
      accept.input.disabled = !item.valid;
      accept.input.checked = item.confirmed;
      summary.textContent = item.confirmed && item.label.trim() ? 'Đã xác nhận trang ' + item.page : 'Chờ xác nhận';
      updateConfirmations();
    }
    const selection = selectPdfExcerpt(page.text, item.receipt.maxExcerptChars, (value, valid, changed) => {
      item.selection = value;
      item.valid = valid;
      if (changed) item.confirmed = false;
      update();
    }, item.selection);
    accept.input.addEventListener('change', () => {
      item.confirmed = item.valid && accept.input.checked;
      update();
    });
    name.input.addEventListener('input', () => {
      item.label = name.input.value;
      update();
    });
    body.append(...selection.elements, name.label, accept.label);
    selection.read();
  }

  prepare.addEventListener('submit', event => {
    event.preventDefault();
    if (!slots.every(slot => slot.file)) {
      setStatus(draftStatus, 'Chọn PDF cho đủ ba vai trò trước khi đọc tài liệu.', true);
      return;
    }
    if (slots.reduce((sum, slot) => sum + slot.file.size, 0) > maxBytes) {
      setStatus(draftStatus, 'Tổng dung lượng ba PDF vượt 2 MiB. Chọn bộ tệp nhỏ hơn.', true);
      return;
    }
    const badRange = slots.find(slot => Number(slot.first.input.value) > Number(slot.last.input.value) ||
      Number(slot.last.input.value) - Number(slot.first.input.value) >= 4);
    if (badRange) {
      setStatus(draftStatus, badRange.title + ' cần một khoảng liên tiếp tối đa 4 trang.', true);
      badRange.first.input.focus();
      return;
    }
    if (!metadata().reference || !metadata().title || !metadata().instructionsText || !synthetic.input.checked) {
      setStatus(draftStatus, 'Điền thông tin hồ sơ và xác nhận bộ tài liệu mô phỏng.', true);
      return;
    }
    perform(draftStatus, 'Đang đọc ba tài liệu…', async () => {
      clearReview();
      const input = await Promise.all(slots.map(async slot => ({
        role: slot.role, content: await base64Pdf(slot.file),
        firstPage: Number(slot.first.input.value), lastPage: Number(slot.last.input.value)
      })));
      const result = await request('pdf-pack/inspect', { synthetic: true, documents: input });
      if (!Array.isArray(result.documents) || result.documents.length !== slots.length ||
        !slots.every(slot => validReceipt(result.documents.find(doc => doc.role === slot.role), slot))) {
        throw new Error('Chưa nhận đủ bản đọc của ba tài liệu. Kiểm tra tệp và đọc lại.');
      }
      batch = slots.map((slot, index) => {
        const receipt = result.documents.find(doc => doc.role === slot.role);
        const { firstPage, lastPage } = input[index];
        const previous = retained.get(slot.role);
        const anchoredPage = receipt.pages.find(item => item.page === previous?.page && item.usable);
        const unchanged = previous && previous.file === slot.file && previous.sha256 === receipt.sha256 &&
          previous.firstPage === firstPage && previous.lastPage === lastPage && anchoredPage &&
          previous.selection.text.length <= receipt.maxExcerptChars &&
          anchoredPage.text.slice(previous.selection.start, previous.selection.end) === previous.selection.text;
        if (unchanged) {
          return { slot, ...input[index], receipt, page: previous.page, label: previous.label,
            valid: true, confirmed: true, selection: previous.selection, preview: null };
        }
        retained.delete(slot.role);
        const page = (receipt.pages.find(item => item.usable) ?? receipt.pages[0]).page;
        const label = slot.file.name.replace(/\.pdf$/i, '').replace(/\s+/gu, ' ').trim().slice(0, 90).toWellFormed() || slot.title;
        return { slot, ...input[index], receipt, page, label, valid: false, confirmed: false, selection: null, preview: null };
      });
      const firstPending = Math.max(0, batch.findIndex(item => !item.confirmed));
      for (const [index, item] of batch.entries()) {
        const card = element('details', '', 'pack-review-card');
        card.name = 'pack-review-document';
        card.open = index === firstPending;
        const heading = element('summary');
        const title = element('span', '', 'pack-review-title');
        title.append(element('strong', item.slot.title), element('small', item.slot.file.name));
        const state = element('span', '', 'pack-review-status');
        heading.append(title, state);
        const body = element('div', '', 'pack-review-body');
        renderDocument(item, body, state);
        card.append(heading, body);
        reviewCards.append(card);
      }
      prepare.hidden = true;
      review.hidden = false;
      setStatus(draftStatus);
      reviewTitle.focus();
    });
  });

  review.addEventListener('submit', event => {
    event.preventDefault();
    if (saveButton.disabled || batch.length !== slots.length || !batch.every(item => item.valid && item.confirmed)) return;
    perform(reviewStatus, 'Đang lưu hồ sơ và tài liệu…', async () => {
      const documents = batch.map(item => ({
        role: item.role, content: item.content, firstPage: item.firstPage, lastPage: item.lastPage,
        label: item.label.trim(), sha256: item.receipt.sha256, page: item.page, ...item.selection, confirmed: true
      }));
      const matter = await request('cases/pdf-pack', { synthetic: true, ...metadata(), documents });
      dialog.close();
      onCreated(matter);
    }, error => {
      if (error.unknownOutcome) {
        savingUncertain = true;
        updateConfirmations();
        error.message = 'Chưa nhận được kết quả lưu. Đóng cửa sổ và tải lại danh sách hồ sơ để kiểm tra mã hồ sơ trước khi gửi lại.';
      }
    });
  });
  const canClose = event => {
    if (readButton.disabled || saveButton.disabled && saveButton.dataset.keepDisabled !== 'true') event.preventDefault();
  };
  dialog.addEventListener('cancel', canClose);
  dialog.addEventListener('close', () => {
    clearReview();
    retained.clear();
    dialog.removeEventListener('cancel', canClose);
  }, { once: true });
  container.append(prepare, review);
  return container;
}
