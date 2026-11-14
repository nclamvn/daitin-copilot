const labels = {
  documents: 'Hồ sơ và biểu mẫu', poa: 'Giấy ủy quyền', deadline: 'Thời hạn',
  fee: 'Phí cơ quan', 'late-fee': 'Nộp muộn và phụ thu', term: 'Hiệu lực', prepay: 'Trả trước một lần',
};
const poaLabels = {
  requirement: 'Có cần POA', reuse: 'POA mới hoặc dùng lại', signer: 'Người ký',
  formality: 'Hình thức hoặc công chứng', direct: 'Chủ thể tự nộp',
};
const maxMail = 16000;
const fold = value => value.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replaceAll('đ', 'd');

function latestText(text) {
  const lines = text.split(/\r?\n/);
  const reply = lines.findIndex(line => /^\s*(?:[-_ ]{2,}\s*(?:Original Message|Forwarded message|Thư gốc)|On .+ wrote:|Vào .+ đã viết:)/iu.test(line));
  return (reply < 0 ? lines : lines.slice(0, reply)).filter(line => !/^\s*>/.test(line)).join('\n');
}

export function suggestMail(text, current = {}) {
  const s = fold(latestText(text));
  const vn = /viet\s*nam|vietnam/.test(s);
  const th = /thai\s*lan|thailand|thai patent/.test(s);
  const outside = /\b(pct|national phase|madrid|petty patent|utility model|kieu dang|design patent|singapore|malaysia|indonesia|opposition|phan doi|assignment|chuyen nhuong|nop don moi|new application)\b/.test(s);
  const renewal = /\b(gia han|renew\w*)\b/.test(s);
  const annuity = /\b(nien phi|duy tri|annuit\w*|annual fees?|maintenance fees?)\b/.test(s);
  const topic = outside || (vn && th) || (vn && current.topic === 'th-annuity') || (th && current.topic === 'vn-renewal') ||
      (renewal && current.topic === 'th-annuity' && /nhan hieu|trade\s*mark/.test(s)) ||
      (annuity && current.topic === 'vn-renewal' && /patent|sang che/.test(s)) ? ''
    : vn && renewal && /nhan hieu|trade\s*mark/.test(s) ? 'vn-renewal'
      : th && annuity && /patent|sang che/.test(s) ? 'th-annuity' : current.topic || '';
  const found = [
    ['documents', /\b(ho so|giay to|bieu mau|to khai|forms?|checklist|documents?|chuan bi gi)\b/],
    ['poa', /\b(poa|uy quyen|power of attorney)\b/],
    ['deadline', /\b(thoi han|han nop|khi nao|deadline|due|bao gio|ngay nao|cap bang muon|late grant)\b/],
    ['fee', /\b(muc phi|le phi|phi co quan|chi phi|bao nhieu tien|bao gia|how much|cost|official fees?|thb|muc thu|tong phi)\b/],
    ['late-fee', /\b(nop muon|nop tre|qua han|phu thu|surcharge|late payment|grace)\b/],
    ['term', /\b(hieu luc bao lau|may nam|thu hoi|revok\w*)\b/],
    ['prepay', /\b(tra truoc|mot lan|prepay|lump sum|one payment)\b/],
  ].filter(([, pattern]) => pattern.test(s)).map(([field]) => field);
  const years = [...new Set([...s.matchAll(/\b(?:nam (?:thu )?|year )([5-9]|1\d|20)\b|\b([5-9]|1\d|20)(?:th|st|nd|rd) year\b/g)]
    .map(match => Number(match[1] || match[2])))];
  const explicitYear = /\b(?:nam (?:thu )?|year )\d+\b|\b\d+(?:th|st|nd|rd) year\b/.test(s);
  const year = topic === 'th-annuity' ? (explicitYear ? (years.length === 1 ? years[0] : null) : current.year ?? null) : null;
  const poaIntents = [
    ['reuse', /\b(dung lai|su dung lai|reuse|existing poa|poa moi|uy quyen moi|fresh poa|new poa)\b/],
    ['signer', /ai ky|ai phai ky|nguoi ky|who signs|who should sign/],
    ['formality', /cong chung|notari[zs]|ban scan|chung thuc|scan copy|scanned|apostille/],
    ['direct', /tu nop|direct filing|without an agent/],
  ].filter(([, pattern]) => pattern.test(s)).map(([intent]) => intent);
  if (poaIntents.length && !found.includes('poa') && current.fields?.includes('poa')) found.push('poa');
  const poa = found.includes('poa') ? poaIntents[0] ?? current.poa ?? 'requirement' : current.poa ?? 'requirement';
  const poaAlso = poaIntents.length > 1 ? poaIntents.slice(1) : !found.includes('poa') ? current.poaAlso ?? [] : [];
  const exactDeadline = /\b(ngay nao|ngay (den han )?cu the|ngay cuoi|han chot|tinh han|exact date|which date|specific date|calendar date)\b/.test(s) ||
    current.exactDeadline === true;
  if (exactDeadline && !found.includes('deadline')) found.push('deadline');
  const dateMatches = [...new Set([...s.matchAll(/\b20[2-9][0-9]\b/g)].map(match => Number(match[0])))];
  const filingYear = topic === 'vn-renewal'
    ? dateMatches.length === 1 ? dateMatches[0] : dateMatches.length > 1 ? null : current.filingYear ?? null
    : null;
  const unclearFilingDate = topic === 'vn-renewal' && (dateMatches.length > 1 ||
    (filingYear === null && (/\b(nam sau|next year|before july|truoc thang 7)\b/.test(s) || current.unclearFilingDate === true)));
  const fields = [...new Set([...(current.fields ?? []), ...found])];
  return { topic, year: fields.includes('fee') ? year : null, poa,
    filingYear: fields.some(id => ['fee','late-fee'].includes(id)) ? filingYear : null, fields,
    ...(poaAlso.length && (found.includes('poa') || current.fields?.includes('poa')) ? { poaAlso } : {}),
    ...(exactDeadline ? { exactDeadline } : {}), ...(unclearFilingDate && [...(current.fields ?? []), ...found].some(id => ['fee','late-fee'].includes(id)) ? { unclearFilingDate } : {}) };
}

export function applyPlan(record, email, input, plan) {
  if (record?.input.topic && input.topic !== record.input.topic) throw Error('Mở thư mới cho thủ tục khác.');
  const now = new Date().toISOString();
  const sections = plan.sections.map(proposed => {
    const prior = record?.sections.find(section => section.id === proposed.id);
    if (prior?.fingerprint === proposed.fingerprint) return { ...prior, changed: false };
    return { ...proposed, draft: proposed.text, approved: false, changed: Boolean(record) };
  });
  const previous = record && { version: record.version, date: record.date, input: record.input,
    sections: record.sections, sourceVersion: record.sourceVersion };
  return {
    id: record?.id ?? crypto.randomUUID(), version: (record?.version ?? 0) + 1, date: now, input, sections,
    sourceVersion: plan.sourceVersion, emails: [...(record?.emails ?? []), { date: now, text: email }],
    history: [...(record?.history ?? []), ...(previous ? [previous] : [])],
  };
}

export function finalMail(snapshot, topic, pending) {
  if (!snapshot?.sections.length || snapshot.sections.some(section => !section.approved || !section.draft.trim())) return '';
  const parts = snapshot.sections.filter(section => section.pending === pending)
    .map(section => section.title + '\n' + section.draft.trim());
  return parts.length ? 'Chào anh/chị,\n\nVề việc ' + topic.toLowerCase() + ',\n\n' +
    parts.join('\n\n') + '\n\nTrân trọng,' : '';
}

export function mountEmailWorkspace({ config, request, copyText, showSource, element, button }) {
  if (!config) return;
  const key = 'daitin:email-workspace:v1:' + config.owner;
  const launcher = document.getElementById('email-launcher');
  const panel = document.getElementById('email-workspace');
  const area = document.getElementById('conversation-scroll');
  let active;
  let staging;
  let busy = false;

  function load() {
    const value = JSON.parse(localStorage.getItem(key) ?? '[]');
    if (!Array.isArray(value)) throw Error('Kho thư trên trình duyệt không đọc được.');
    return value;
  }
  function persist(next, expected) {
    const saved = load();
    const current = saved.find(record => record.id === next.id);
    if (current?.change !== expected) throw Error('Thư vừa đổi ở tab khác. Mở lại bản đã lưu.');
    const output = { ...next, change: crypto.randomUUID() };
    localStorage.setItem(key, JSON.stringify([output, ...saved.filter(record => record.id !== next.id)]));
    active = output;
    return output;
  }
  function label(text, field) {
    const group = element('label', 'email-field', text);
    field.setAttribute('aria-label', text);
    group.append(field);
    return group;
  }
  function note(text) {
    panel.querySelector('[role="status"]').textContent = text;
  }
  function base(title) {
    const status = element('p', 'email-status');
    status.setAttribute('role', 'status');
    const head = element('header', 'email-head');
    head.append(element('h2', '', title), button('Về hỏi đáp', 'ghost', () => {
      panel.hidden = true;
      staging = undefined;
      area.classList.remove('email-open');
      launcher.focus();
    }));
    panel.replaceChildren(head, status);
    panel.hidden = false;
    area.classList.add('email-open');
    area.scrollTop = 0;
    return head;
  }
  function recordTitle(record) {
    const subject = record.emails[0].text.split('\n').find(line => /^(subject|chu de|tiêu đề|chủ đề)\s*:/iu.test(line.trim()));
    return subject?.replace(/^[^:]+:/, '').trim().slice(0, 110) || config.topics[record.input.topic].label;
  }
  function list() {
    active = undefined;
    staging = undefined;
    base('Thư khách');
    panel.append(intake());
    const saved = load();
    if (saved.length) panel.append(element('h3', 'email-list-title', 'Cuộc trao đổi đã lưu'));
    for (const record of saved) {
      const row = element('div', 'email-record');
      const open = button(recordTitle(record), 'email-record-link', () => { active = record; render(); });
      row.append(open, element('span', 'email-quiet', 'Bản ' + record.version + ' · ' +
        record.sections.filter(section => section.approved).length + '/' + record.sections.length + ' đã duyệt'));
      panel.append(row);
    }
  }
  function intake(record) {
    const form = element('form', 'email-intake');
    const fieldLabel = record ? 'Nội dung thư mới' : 'Nội dung email khách';
    const text = element('textarea', 'email-input');
    text.rows = record ? 2 : 5;
    text.maxLength = maxMail;
    text.placeholder = record ? 'Dán thư mới để cập nhật bản nháp' : 'Dán email khách để soạn bản trả lời';
    const scope = element('div', 'email-scope');
    const summary = element('p', 'email-scope-summary');
    summary.setAttribute('aria-live', 'polite');
    const details = element('details', 'email-scope-details');
    details.append(element('summary', '', 'Chỉnh phạm vi'));
    let suggestedFields = [];
    const procedure = element('select');
    for (const [value, name] of [['', 'Chọn thủ tục'], ...Object.entries(config.topics).map(([id, topic]) => [id, topic.label])]) {
      const option = element('option', '', name);
      option.value = value;
      procedure.append(option);
    }
    procedure.disabled = Boolean(record);
    const fields = element('fieldset', 'email-fields');
    const year = element('input');
    year.type = 'number';
    year.min = '5';
    year.max = '20';
    const yearLabel = label('Năm niên phí (5–20)', year);
    const filingYear = element('input');
    filingYear.type = 'number';
    filingYear.min = '2020';
    filingYear.max = '2099';
    const filingYearLabel = label('Năm nộp hồ sơ (nếu đã biết)', filingYear);
    const exactDeadline = element('input');
    exactDeadline.type = 'checkbox';
    const exactLabel = label('Khách cần ngày đến hạn cụ thể', exactDeadline);
    const uncertainDate = element('input');
    uncertainDate.type = 'checkbox';
    const uncertainLabel = label('Chưa rõ thời điểm áp dụng biểu phí', uncertainDate);
    const poa = element('select');
    for (const [value, name] of Object.entries(poaLabels)) {
      const option = element('option', '', name);
      option.value = value;
      poa.append(option);
    }
    const poaLabel = label('Chi tiết về POA', poa);
    const partner = element('input');
    partner.type = 'text';
    partner.maxLength = 50;
    partner.pattern = '[a-z0-9\\-]{1,50}';
    partner.placeholder = 'Mã đã duyệt trong Kho nguồn';
    partner.setAttribute('list', 'email-partners');
    const options = element('datalist');
    options.id = 'email-partners';
    for (const issuer of config.partners ?? []) {
      const option = element('option');
      option.value = issuer;
      options.append(option);
    }
    const partnerLabel = label('Mã đối tác đang xử lý hồ sơ này', partner);
    const extraPoa = element('fieldset', 'email-fields');
    extraPoa.append(element('legend', '', 'Các ý POA hỏi thêm'));
    for (const [value, name] of Object.entries(poaLabels)) {
      const checkbox = element('input');
      checkbox.type = 'checkbox';
      checkbox.value = value;
      extraPoa.append(label(name, checkbox));
    }
    const extraControls = [...extraPoa.querySelectorAll('input')];
    const extraValues = () => extraControls.filter(control => control.checked && control.value !== poa.value).map(control => control.value);
    function displayFields(selected) {
      fields.replaceChildren(element('legend', '', 'Mục khách cần trả lời'));
      for (const field of config.topics[procedure.value]?.fields ?? []) {
        const checkbox = element('input');
        checkbox.type = 'checkbox';
        checkbox.value = field;
        checkbox.checked = selected.includes(field);
        fields.append(label(labels[field], checkbox));
      }
      updateControls();
    }
    const checked = () => [...fields.querySelectorAll('input:checked')].map(control => control.value);
    const generate = element('button', 'primary', record ? 'Cập nhật theo thư mới' : 'Soạn theo nguồn');
    generate.type = 'submit';
    let blocked = '';
    function updateControls() {
      const fieldsSelected = checked();
      yearLabel.hidden = procedure.value !== 'th-annuity' || !fieldsSelected.includes('fee');
      poaLabel.hidden = !fieldsSelected.includes('poa');
      partnerLabel.hidden = !config.private || poaLabel.hidden;
      extraPoa.hidden = poaLabel.hidden;
      for (const control of extraControls) control.disabled = control.value === poa.value;
      filingYearLabel.hidden = procedure.value !== 'vn-renewal' || !fieldsSelected.some(item => ['fee','late-fee'].includes(item));
      uncertainLabel.hidden = filingYearLabel.hidden;
      exactLabel.hidden = !fieldsSelected.includes('deadline');
      filingYear.disabled = uncertainDate.checked;
      const topic = config.topics[procedure.value];
      const conditions = [!yearLabel.hidden && (year.value ? 'Năm niên phí ' + year.value : 'Chưa rõ năm niên phí'),
        !poaLabel.hidden && [poa.value, ...extraValues()].map(value => poaLabels[value]).join(', '),
        !partnerLabel.hidden && partner.value && 'Đối tác ' + partner.value,
        !exactLabel.hidden && exactDeadline.checked && 'Cần ngày đến hạn cụ thể',
        !filingYearLabel.hidden && (uncertainDate.checked ? 'Chưa rõ thời điểm áp dụng biểu phí' : filingYear.value && 'Năm nộp ' + filingYear.value)];
      summary.textContent = blocked || (topic && fieldsSelected.length
        ? [topic.label, fieldsSelected.map(id => labels[id]).join(', '), ...conditions.filter(Boolean)].join(' · ')
        : 'Chọn thủ tục và các mục cần trả lời.');
      scope.hidden = !text.value.trim();
      details.hidden = Boolean(blocked);
      generate.disabled = Boolean(blocked || !text.value.trim() || !topic || !fieldsSelected.length);
    }
    procedure.addEventListener('change', () => displayFields([...new Set([...suggestedFields, ...checked()])]));
    details.addEventListener('input', updateControls);
    text.addEventListener('input', () => {
      const email = text.value.trim();
      const thread = record ? active : undefined;
      const input = suggestMail(email, thread?.input);
      blocked = thread?.emails.some(entry => entry.text === email) ? 'Thư này đã có trong cuộc trao đổi.'
        : thread?.emails.length >= 20 ? 'Cuộc trao đổi đã có 20 thư.'
          : thread && !input.topic ? 'Thư có dấu hiệu đổi thủ tục. Hãy mở một cuộc trao đổi riêng.' : '';
      procedure.value = input.topic;
      suggestedFields = input.fields;
      year.value = input.year ?? '';
      filingYear.value = input.filingYear ?? '';
      poa.value = input.poa;
      partner.value = '';
      for (const control of extraControls) control.checked = input.poaAlso?.includes(control.value) ?? false;
      exactDeadline.checked = input.exactDeadline ?? false;
      uncertainDate.checked = input.unclearFilingDate ?? false;
      displayFields(input.fields);
      details.open = !blocked && Boolean(email) && (!procedure.value || !checked().length);
    });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (busy) return;
      const thread = record ? active : undefined;
      if (record && thread?.id !== record.id) return;
      const email = text.value.trim();
      const chosen = { topic: procedure.value, fields: checked(), poa: poaLabel.hidden ? 'requirement' : poa.value,
        year: yearLabel.hidden || !year.value ? null : Number(year.value),
        filingYear: filingYearLabel.hidden || uncertainDate.checked || !filingYear.value ? null : Number(filingYear.value),
        ...(!poaLabel.hidden && extraValues().length ? { poaAlso: extraValues() } : {}),
        ...(!partnerLabel.hidden && partner.value.trim() ? { partnerIssuer: partner.value.trim() } : {}),
        ...(!exactLabel.hidden && exactDeadline.checked ? { exactDeadline: true } : {}),
        ...(!uncertainLabel.hidden && uncertainDate.checked ? { unclearFilingDate: true } : {}) };
      if (!email || blocked || !chosen.topic || !chosen.fields.length || (!yearLabel.hidden && !year.validity.valid) ||
          (!filingYearLabel.hidden && !filingYear.validity.valid)) {
        details.open = !blocked;
        return note(blocked || 'Kiểm lại thư, thủ tục, mục trả lời và năm áp dụng.');
      }
      busy = true;
      generate.disabled = true;
      const intakeState = { form };
      staging = intakeState;
      text.readOnly = true;
      details.inert = true;
      try {
        const plan = await request('email-plan', chosen);
        if (panel.hidden || staging !== intakeState || !form.isConnected || form.hidden) return;
        persist(applyPlan(thread, email, chosen, plan), thread?.change);
        staging = undefined;
        busy = false;
        render(true);
      } catch (error) { if (form.isConnected) note(error.message); }
      finally { busy = false; text.readOnly = false; details.inert = false; updateControls(); }
    });
    details.append(label('Thủ tục', procedure), fields, yearLabel, filingYearLabel, uncertainLabel, exactLabel, poaLabel, extraPoa,
      partnerLabel, options);
    scope.append(summary, details);
    form.append(label(fieldLabel, text), scope, generate);
    if (!record) form.append(element('p', 'email-quiet', 'Nội dung thư lưu trên trình duyệt này. Tra cứu dùng phạm vi đã chọn.'));
    displayFields([]);
    return form;
  }
  function render(focusReview = false) {
    const { input } = active;
    const topic = config.topics[input.topic].label;
    base(recordTitle(active));
    const tools = element('div', 'email-actions');
    tools.append(button('Danh sách thư', 'ghost', list), element('span', 'email-quiet', topic));
    const versions = element('select');
    for (const item of [active, ...active.history.slice().reverse()]) {
      const option = element('option', '', 'Bản ' + item.version);
      option.value = item.version;
      versions.append(option);
    }
    tools.append(label('Phiên bản', versions));
    const messages = element('details', 'email-transcript');
    messages.append(element('summary', '', 'Thư đã nhận (' + active.emails.length + ')'));
    for (const entry of active.emails) messages.append(element('p', '', entry.text));
    const content = element('div', 'email-review');
    const newMail = intake(active);
    panel.append(tools, messages, newMail, content);
    function renderVersion() {
      content.replaceChildren();
      const current = Number(versions.value) === active.version;
      newMail.hidden = !current;
      if (!current && staging?.form === newMail) staging = undefined;
      const view = current ? active : active.history.find(item => item.version === Number(versions.value));
      const counter = element('p', 'email-quiet');
      const actions = element('div', 'email-actions');
      const controls = new Map();
      const sync = () => {
        const snapshot = current ? active : view;
        const remaining = snapshot.sections.filter(section => !section.approved);
        counter.textContent = (snapshot.sections.length - remaining.length) + '/' + snapshot.sections.length + ' mục đã duyệt';
        copyClient.disabled = !current || !finalMail(snapshot, topic, false);
        copyPartner.disabled = !current || !finalMail(snapshot, topic, true);
        copyClient.hidden = !current || !snapshot.sections.some(section => !section.pending);
        copyPartner.hidden = !current || !snapshot.sections.some(section => section.pending);
        for (const section of snapshot.sections) {
          const control = controls.get(section.id);
          control.combined.hidden = !current || section.approved || remaining.length !== 1 || !section.draft.trim();
          control.approve.textContent = section.approved ? 'Bỏ duyệt' : 'Duyệt mục';
          control.approve.setAttribute('aria-pressed', String(section.approved));
          control.flag.textContent = section.approved ? 'Đã duyệt' : section.changed ? 'Đã đổi · cần duyệt lại' : 'Chờ duyệt';
          control.card.classList.toggle('email-section-approved', section.approved);
        }
      };
      async function copy(pending) {
        const snapshot = current ? active : view;
        const value = finalMail(snapshot, topic, pending);
        if (!current || !value || busy) return;
        busy = true;
        note('Đang kiểm phiên bản nguồn…');
        try {
          const fresh = await request('email-plan', snapshot.input);
          const saved = load().find(record => record.id === snapshot.id);
          if (!content.isConnected || panel.hidden || active?.id !== snapshot.id) return;
          if (active !== snapshot || saved?.change !== snapshot.change || Number(versions.value) !== snapshot.version) {
            return note('Bản nháp vừa đổi. Mở lại trước khi sao chép.');
          }
          if (fresh.sourceVersion !== snapshot.sourceVersion || fresh.sections.length !== snapshot.sections.length ||
              fresh.sections.some((item, i) => item.fingerprint !== snapshot.sections[i]?.fingerprint)) {
            const next = applyPlan(snapshot, '', snapshot.input, fresh);
            next.emails = snapshot.emails;
            persist(next, snapshot.change);
            busy = false;
            render();
            return note('Nguồn đã cập nhật. Duyệt lại các mục thay đổi.');
          }
          note(await copyText(value) ? 'Đã sao chép bản ' + snapshot.version : 'Chưa sao chép được. Kiểm tra quyền clipboard.');
        } catch (error) { if (content.isConnected && !panel.hidden) note(error.message); }
        finally { busy = false; }
      }
      const copyClient = button('Sao chép bản trả lời', 'primary', () => copy(false));
      const copyPartner = button('Sao chép thư xác nhận', 'ghost', () => copy(true));
      actions.append(copyClient, copyPartner);
      const replaceSection = (id, update) => {
        persist({ ...active, sections: active.sections.map(item => item.id === id ? { ...item, ...update } : item) }, active.change);
        sync();
      };
      content.append(counter);
      for (const section of view.sections) {
        const card = element('section', 'email-section');
        card.dataset.field = section.id;
        const heading = element('h3', '', section.title);
        const flag = element('span', 'email-quiet');
        const draft = element('textarea', 'draft-text');
        draft.rows = 4;
        draft.maxLength = 6000;
        draft.value = section.draft;
        draft.readOnly = !current;
        function review(alsoCopy) {
          const item = active.sections.find(item => item.id === section.id);
          if (!current || !item || (alsoCopy && (busy || item.approved || active.sections.filter(row => !row.approved).length !== 1))) return;
          try {
            if (!item.approved && !draft.value.trim()) return note('Nhập nội dung trước khi duyệt.');
            replaceSection(section.id, { draft: draft.value, approved: !item.approved });
            note('');
            if (alsoCopy) {
              (section.pending ? copyPartner : copyClient).focus();
              void copy(section.pending);
            }
          } catch (error) { note(error.message); }
        }
        const approve = button('Duyệt mục', 'ghost', () => review(false));
        const combined = button(section.pending ? 'Duyệt mục và sao chép thư xác nhận' : 'Duyệt mục và sao chép bản trả lời',
          'primary', () => review(true));
        controls.set(section.id, { card, flag, approve, combined });
        approve.hidden = !current;
        draft.addEventListener('input', () => {
          try {
            replaceSection(section.id, { draft: draft.value, approved: false });
            note('');
          } catch (error) {
            copyClient.disabled = true;
            copyPartner.disabled = true;
            note(error.message);
          }
        });
        const sources = element('ul', 'email-evidence');
        sources.setAttribute('aria-label', 'Căn cứ của mục');
        section.sources.forEach((source, i) => {
          const reference = element('li', 'email-reference');
          reference.dataset.sourceId = source.id;
          const open = button(source.locator || source.anchor, 'email-source-link', event =>
            showSource({ sources: section.sources, chips: [], conflict: false }, i, event.currentTarget));
          reference.append(open);
          if (source.date || source.state === 'superseded') {
            const date = source.date?.split('-').reverse().join('/');
            reference.append(element('p', 'email-reference-date', [date, source.state === 'superseded' && 'Đã thay thế']
              .filter(Boolean).join(' · ')));
          }
          reference.append(element('blockquote', '', source.quote));
          sources.append(reference);
        });
        draft.setAttribute('aria-label', section.title);
        if (section.pending) {
          card.classList.add('email-section-pending');
          card.append(element('p', 'email-destination', 'Thư xác nhận'));
        }
        const top = element('div', 'email-section-top');
        top.append(heading, flag);
        const approvals = element('div', 'email-actions email-approvals');
        approvals.append(approve, combined);
        card.append(top, draft);
        if (section.note) card.append(element('p', 'email-destination', section.note));
        if (section.sources.length) card.append(sources);
        if (current) card.append(approvals);
        content.append(card);
      }
      content.append(actions);
      sync();
    }
    versions.addEventListener('change', renderVersion);
    renderVersion();
    if (focusReview) {
      const focus = content.querySelector('.email-section:not(.email-section-approved) h3') ?? content.querySelector('p');
      focus.tabIndex = -1;
      focus.focus();
    }
  }
  launcher.hidden = false;
  launcher.addEventListener('click', () => {
    try { list(); }
    catch (error) { base('Thư khách'); note(error.message); }
  });
  window.addEventListener('storage', event => {
    if (event.key === key && !panel.hidden) {
      base('Thư khách');
      note('Dữ liệu vừa đổi ở tab khác. Mở lại danh sách thư.');
      panel.append(button('Mở lại danh sách', 'primary', list));
    }
  });
  return () => {
    staging = undefined;
    if (panel.hidden) return;
    panel.hidden = true;
    area.classList.remove('email-open');
  };
}
