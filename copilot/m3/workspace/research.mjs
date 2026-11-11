const $ = id => document.getElementById(id);
const fmt = value => value?.split('-').reverse().join('/');

export async function m5Request(path, body) {
  const response = await fetch('/api/m5/' + path, body === undefined ? undefined : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? 'Chưa truy cập được chức năng pilot.');
  return data;
}

export function createResearchUI({ node, button, run, showDialog, matter, onSave, onNew, onMode, onTemplate }) {
  let enabled = false;
  let asking = false;
  let actor;
  let result;
  let payload;
  let queued;
  let workText = '';
  let askText = '';
  const task = $('task');
  const date = $('ask-date');
  const received = $('ask-received');
  const context = $('ask-context');
  const pending = $('ask-pending');

  function link(label, url) {
    const el = node('a', label);
    el.href = url;
    el.target = '_blank';
    el.rel = 'noopener noreferrer';
    return el;
  }

  function syncDates() {
    const existing = context.value === 'case';
    $('ask-received-label').hidden = !existing;
    const cutover = existing && received.value && received.value < actor.cutover && date.value >= actor.cutover;
    $('ask-pending-label').hidden = !cutover;
    if (!cutover) pending.value = '';
  }

  function facts(values = {}) {
    date.value = values.asOf ?? '';
    received.value = values.receivedOn ?? '';
    context.value = values.mode ?? (values.receivedOn ? 'case' : 'prepare');
    pending.value = typeof values.pendingAtCutover === 'boolean' ? (values.pendingAtCutover ? 'yes' : 'no') : '';
    syncDates();
  }

  function mode(next) {
    if (!enabled || next === asking) return;
    if (asking) askText = task.value;
    else workText = task.value;
    asking = next;
    task.value = asking ? askText : workText;
    onMode();
    task.focus();
  }

  function sourceDetails(proof) {
    const container = node('div', undefined, 'research-provenance');
    if (proof.applicableOn) container.append(node('p', 'Mốc áp dụng ' + fmt(proof.applicableOn), 'research-metadata'));
    if (proof.form) {
      const form = proof.form;
      const item = node('div', undefined, 'research-citation');
      item.append(node('h3', form.title),
        node('p', form.document + ' · Phụ lục ' + form.appendix + ' · trang PDF ' + form.page),
        link('Mở đúng phiên bản biểu mẫu', form.snapshotUrl), link('Bản gốc chính thức', form.originalUrl));
      container.append(item);
    }
    for (const citation of proof.citations) {
      const item = node('div', undefined, 'research-citation');
      const statuses = { applicable: 'Áp dụng tại mốc đã xét', historical: 'Phiên bản lịch sử', future: 'Chưa áp dụng tại mốc đã xét', unchecked: 'Ngoài mốc kiểm chứng' };
      item.append(node('h3', citation.locator), node('p', citation.document + ' · trang PDF ' + citation.page +
        ' · ' + statuses[citation.status], 'research-metadata'));
      if (citation.summary !== proof.explanation) item.append(node('p', citation.summary));
      item.append(link('Mở đúng trang', citation.snapshotUrl), link('Bản gốc chính thức', citation.originalUrl));
      if (citation.quote) {
        const quote = node('details');
        quote.append(node('summary', 'Đoạn trích từ nguồn'), node('blockquote', citation.quote));
        item.append(quote);
      }
      container.append(item);
    }
    if (proof.template) {
      const item = node('div', undefined, 'research-citation');
      item.append(node('h3', proof.template.title), node('p', 'Mẫu nội bộ mô phỏng · Phiên bản ' + proof.template.version,
        'research-metadata'), node('p', proof.template.text));
      container.append(item);
    }
    return container;
  }

  function attachment() {
    return { input: payload, proofId: result.proofId };
  }

  function apply() {
    if (matter()) {
      return run('Đang lưu căn cứ vào hồ sơ…', async () => {
        await onSave(attachment());
        mode(false);
        return 'Đã lưu căn cứ cùng phiên bản nguồn và mẫu.';
      });
    }
    queued = { ...attachment(), answer: result };
    onNew(result.fields);
    mode(false);
  }

  function renderResult() {
    const panel = $('research-result');
    if (!result) {
      panel.replaceChildren(node('h2', 'Hỏi đáp nhãn hiệu'),
        node('p', 'Kiểm căn cứ theo ngày và mở đúng trang. Khi cần soạn phản hồi, lưu kết quả cùng nguồn vào hồ sơ.'),
        node('p', 'Phạm vi pilot gồm phản hồi thẩm định và biểu mẫu gia hạn của tuyến quốc gia Việt Nam.', 'research-metadata'));
      return;
    }
    const scope = node('p', result.scope + ' · Kho thử nghiệm đến ' + fmt(result.coverage.through), 'research-metadata');
    const status = node('span', result.proofId || result.status === 'grounded' ? 'Đã đối chiếu với kho' :
      result.status === 'reference' || result.status === 'references' ? 'Tham chiếu' :
        result.status === 'historical' ? 'Đối chiếu lịch sử' : 'Cần kiểm tra thêm', 'research-state');
    const head = node('div', undefined, 'research-heading');
    head.append(node('h2', result.title), status);
    panel.replaceChildren(scope, head, node('p', result.explanation), sourceDetails(result));
    if (result.referral) {
      for (const target of result.referral.targets) panel.append(node('p',
        target.code + ' · ' + target.label + ' · ' + target.status, 'research-metadata'));
      panel.append(link(result.referral.label, result.referral.url));
    }
    if (result.proofId) panel.append(button(matter() ? 'Lưu căn cứ vào hồ sơ' : 'Dùng căn cứ cho hồ sơ mới', apply, 'primary'));
  }

  function submit() {
    const question = task.value.trim();
    if (!question) return task.focus();
    const request = { question, asOf: date.value || null, mode: context.value,
      receivedOn: $('ask-received-label').hidden ? null : received.value || null,
      pendingAtCutover: $('ask-pending-label').hidden || !pending.value ? null : pending.value === 'yes',
      anonymized: $('ask-anonymized').checked };
    return run('Đang đối chiếu câu hỏi với kho nguồn…', async () => {
      result = null;
      payload = null;
      renderResult();
      result = await m5Request('research', request);
      payload = request;
      if (result.fields) facts(result.fields);
      renderResult();
    }).then(() => {
      if (result?.missing.includes('asOf')) date.focus();
      if (result?.missing.includes('receivedOn')) received.focus();
      if (result?.missing.includes('pendingAtCutover')) pending.focus();
    });
  }

  function preview(proof) {
    showDialog('Căn cứ đã lưu', node('p', proof.question), node('p', proof.explanation), sourceDetails(proof),
      node('p', 'Dấu kiểm ' + proof.proofId, 'file-fingerprint'));
  }

  function binding(id, proof, stale) {
    const panel = $(id);
    panel.hidden = !proof;
    if (!proof) return panel.replaceChildren();
    const copy = node('div');
    copy.append(node('strong', stale ? 'Cần rà soát lại căn cứ' : 'Căn cứ đã gắn với hồ sơ'),
      node('p', (stale ? 'Nguồn hoặc mẫu đã đổi. Tra lại để tiếp tục. Bản duyệt cũ vẫn có thể mở. ' : '') +
        proof.citations.length + ' vị trí nguồn · Mẫu nội bộ bản ' + proof.template.version));
    const actions = node('div', undefined, 'research-binding-actions');
    actions.append(button('Xem căn cứ', () => preview(proof)));
    if (id === 'research-intake') actions.append(button('Bỏ gắn', () => { queued = null; onMode(); }));
    if (stale) actions.append(button('Tra lại', () => {
      mode(true);
      task.value = proof.question;
      facts(proof.fields);
      task.focus();
    }));
    panel.toggleAttribute('data-stale', Boolean(stale));
    panel.replaceChildren(copy, actions);
  }

  async function templates() {
    const data = await m5Request('templates');
    const state = data.current;
    const version = item => node('p', 'Phiên bản ' + item.version + ' · ' + item.title);
    const current = node('div', undefined, 'research-citation');
    current.append(node('h3', 'Đang dùng'), version(state), node('p', state.text));
    const form = node('form', undefined, 'source-form');
    const title = node('input');
    title.required = true;
    title.maxLength = 100;
    title.value = state.title;
    const text = node('textarea');
    text.required = true;
    text.maxLength = 800;
    text.value = state.text;
    const titleLabel = node('label', 'Tên mẫu');
    titleLabel.append(title);
    const textLabel = node('label', 'Nội dung đề xuất');
    textLabel.append(text);
    form.append(titleLabel, textLabel, node('button', 'Lưu đề xuất', 'primary'));
    form.addEventListener('submit', event => {
      event.preventDefault();
      run('Đang lưu đề xuất mẫu…', async () => {
        await m5Request('templates/stage', { base: state.digest, title: title.value, text: text.value });
        await templates();
        return 'Đã lưu đề xuất để luật sư khác rà soát.';
      });
    });
    const options = data.versions.filter(item => item.status !== 'current').map(item => {
      const row = node('details', undefined, 'research-citation');
      const stage = item.status === 'staged';
      const status = stage ? 'Chờ duyệt' : 'Đã dùng trước đây';
      row.append(node('summary', 'Bản ' + item.version + ' · ' + status));
      if (stage && item.base === state.digest) {
        const before = node('div');
        const after = node('div');
        before.append(node('strong', 'Bản đang dùng'), node('p', state.title), node('p', state.text));
        after.append(node('strong', 'Bản đề xuất'), node('p', item.title), node('p', item.text));
        const compare = node('div', undefined, 'research-template-compare');
        compare.append(before, after);
        row.append(compare);
      } else row.append(node('p', item.title), node('p', item.text));
      row.append(node('p', 'Dấu kiểm ' + item.digest, 'file-fingerprint'));
      if (actor.role === 'reviewer' && (!stage || (item.author !== actor.name && item.base === state.digest))) {
        const action = stage ? 'publish' : 'rollback';
        row.append(button(stage ? 'Duyệt và công bố bản ' + item.version : 'Khôi phục bản ' + item.version,
          () => run('Đang cập nhật mẫu đang dùng…', async () => {
            await m5Request('templates/' + action, { base: state.digest, version: item.version, digest: item.digest });
            await onTemplate();
            await templates();
            return 'Đã cập nhật danh mục mẫu nội bộ mô phỏng.';
          }), 'quiet'));
      }
      return row;
    });
    const history = node('details');
    history.append(node('summary', 'Nhật ký công bố'),
      ...data.history.map(item => node('p', (item.action === 'publish' ? 'Công bố' : 'Khôi phục') +
        ' bản ' + item.version + ' · ' + item.actor + ' · ' + new Date(item.at).toLocaleString('vi-VN'))));
    showDialog('Phiên bản mẫu nội bộ', node('p', 'Danh mục mô phỏng. Nội dung mẫu dùng để rà soát trong hồ sơ.'), current,
      ...options, history, form);
  }

  $('mode-ask').addEventListener('click', () => mode(true));
  $('mode-work').addEventListener('click', () => mode(false));
  for (const field of [date, received, context]) field.addEventListener('change', syncDates);
  $('templates-admin').addEventListener('click', () => run('Đang mở danh mục mẫu…', templates));
  return {
    get asking() { return asking; },
    get cutover() { return actor?.cutover ?? '2026-07-01'; },
    get canApprove() { return !enabled || actor.role === 'reviewer'; },
    enable(value, startWithQuestion) {
      enabled = true;
      actor = value;
      asking = startWithQuestion;
      $('composer-modes').hidden = false;
      $('templates-admin').hidden = false;
      document.querySelector('.env-index').textContent = 'M5';
    },
    switchMatter(value, openNewForm = false) {
      if (!enabled) return;
      asking = !value && !openNewForm;
      queued = null;
      result = null;
      payload = null;
      askText = '';
      workText = '';
      facts(value?.facts);
    },
    render() {
      $('research-paper').hidden = !asking;
      $('research-facts').hidden = !asking;
      $('mode-ask').setAttribute('aria-pressed', String(asking));
      $('mode-work').setAttribute('aria-pressed', String(!asking));
      task.maxLength = asking ? 300 : 400;
      const title = $('composer').querySelector('label[for=task]');
      title.firstChild.textContent = asking ? 'Câu hỏi tra cứu' : 'Giao việc trong ';
      $('composer-case').hidden = asking;
      $('composer').querySelector('.inputs').hidden = asking;
      $('composer').classList.toggle('asking', asking);
      if (asking) renderResult();
      binding('research-intake', queued?.answer);
      binding('research-saved', matter()?.research, matter()?.templateChanged || matter()?.sourceChanged);
    },
    preset() {
      task.value = matter() ? 'Cần dùng biểu mẫu nào để phản hồi thông báo thẩm định nhãn hiệu?' :
        'Gia hạn nhãn hiệu dùng mẫu nào?';
      task.focus();
    },
    submit, preview,
    pending: () => queued && { input: queued.input, proofId: queued.proofId }
  };
}
