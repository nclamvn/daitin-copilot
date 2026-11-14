const preview = globalThis.daitinAdvicePreview;
const byId = id => document.getElementById(id);
const turns = byId('turns');
const history = byId('history');
const query = byId('query');
const feedback = byId('feedback');
const submit = byId('submit');
const evidence = byId('evidence');
const mobile = window.matchMedia('(max-width: 860px)');
let scenario = 'word';
let libraryMode = false;
let latestQuestion = '';
let currentScope;
let previousForLatest;
let activeTurn;
let closeEmailWorkspace;
let closeDailyPilot;
let drawerTrigger;

function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content) node.textContent = content;
  return node;
}

function button(label, className, click) {
  const node = element('button', className, label);
  node.type = 'button';
  node.addEventListener('click', click);
  return node;
}

async function request(path, body) {
  if (preview) return body ? preview.ask(body) : preview.config;
  const response = await fetch('/api/advice/' + path, body && {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (response.status === 401) throw new Error('Phiên đã hết hạn. Tải lại trang để đăng nhập.');
  if (!response.ok) {
    const problem = await response.json().catch(() => null);
    throw new Error(problem?.error ?? 'Tạm thời chưa mở được nguồn. Vui lòng thử lại.');
  }
  return response.json();
}

function setDrawer(open, trigger) {
  evidence.classList.toggle('drawer-open', open);
  byId('source-toggle').setAttribute('aria-expanded', String(open));
  if (!libraryMode && !mobile.matches) return;
  if (open) {
    drawerTrigger = trigger;
    byId('source-close').focus();
  } else {
    drawerTrigger?.focus();
    drawerTrigger = undefined;
  }
}

const sourceStates = {
  active: 'Căn cứ đang dùng',
  superseded: 'Đã được thay thế trong diễn tập',
  context: 'Chỉ để đối chiếu phạm vi',
};

function sourceLabel(source, index) {
  const type = source.origin ? 'Văn bản công khai' : source.kind === 'word' ? 'Word' : 'Email';
  return '[' + (index + 1) + '] ' + type;
}

function showSource(context, index, trigger) {
  for (const { i, chip } of context.chips) chip.setAttribute('aria-pressed', String(i === index));
  const tabs = byId('source-tabs');
  const detail = byId('source-detail');
  tabs.replaceChildren();
  detail.replaceChildren();
  const source = context.sources[index];
  if (!source) {
    detail.append(element('p', 'empty-evidence', 'Chưa có đoạn nguồn phù hợp để mở.'));
    return;
  }
  for (const [i, item] of context.sources.entries()) {
    const tab = button(sourceLabel(item, i), 'cite', () => {
      showSource(context, i);
      tabs.children[i].focus();
    });
    tab.setAttribute('aria-pressed', String(i === index));
    tabs.append(tab);
  }
  const card = element('article', 'source-sheet');
  const state = context.conflict && source.state === 'active' ? 'Nguồn đang mâu thuẫn' : sourceStates[source.state];
  card.append(element('span', 'tag', state),
    element('h3', '', source.title),
    element('p', 'source-location', source.anchor),
    element('blockquote', 'source-quote', source.quote));
  const facts = element('dl', 'source-facts');
  for (const [label, value] of [
    ['Nguồn', source.simulated ? 'Mô phỏng' : source.origin ? 'Nguồn công khai' : 'Tài liệu nội bộ'],
    ['Ngày nguồn', source.date ? source.date.split('-').reverse().join('/') : 'Chưa ghi nhận'],
    ['Phạm vi', source.note],
  ]) {
    if (value) facts.append(element('dt', '', label), element('dd', '', value));
  }
  card.append(facts);
  if (source.origin) {
    const original = element('a', 'source-download', 'Mở tài liệu cơ quan');
    const url = new URL(source.origin);
    const page = source.locator?.match(/trang PDF (\d+)/iu);
    if (page && !url.hash) url.hash = 'page=' + page[1];
    original.href = url.href;
    original.target = '_blank';
    original.rel = 'noreferrer noopener';
    card.append(original, document.createElement('br'));
  }
  if (source.form) {
    const form = element('a', 'source-download', 'Mở đúng mẫu tờ khai');
    form.href = source.form;
    form.target = '_blank';
    form.rel = 'noopener noreferrer';
    card.append(form);
  }
  if (source.download) {
    const download = element('a', 'source-download', source.simulated ? 'Tải tài liệu mô phỏng' : source.origin ? 'Tải phiếu đối chiếu' : 'Tải nguồn gốc');
    download.href = source.download;
    card.append(download);
  }
  detail.append(card);
  if (trigger) setDrawer(true, trigger);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const previous = document.activeElement;
    const field = element('textarea');
    field.value = text;
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.append(field);
    field.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    } finally {
      field.remove();
      previous?.focus();
    }
  }
}

function appendEmail(card, answer, context) {
  const actions = element('div', 'answer-actions suggestions');
  const editor = element('div', 'draft-editor');
  editor.hidden = true;
  const text = element('textarea', 'draft-text');
  text.setAttribute('aria-label', 'Nội dung email có thể chỉnh sửa');
  text.value = answer.email;
  const notice = element('span', 'copy-note');
  notice.setAttribute('role', 'status');
  const copy = async () => {
    const draft = text.value.trim();
    if (!draft) {
      editor.hidden = false;
      edit.setAttribute('aria-expanded', 'true');
      text.focus();
      notice.textContent = 'Nhập nội dung trước khi sao chép.';
      return;
    }
    const watermark = '[MÔ PHỎNG — CHỈ DÙNG DIỄN TẬP]';
    const marked = !answer.simulation || draft.startsWith(watermark) ? draft : watermark + '\n\n' + draft;
    if (await copyText(marked)) notice.textContent = 'Đã sao chép';
    else {
      editor.hidden = false;
      edit.setAttribute('aria-expanded', 'true');
      text.focus();
      text.select();
      notice.textContent = 'Đã chọn bản nháp. Dùng lệnh sao chép trên thiết bị.';
    }
  };
  const edit = button(answer.emailKind === 'reply' ? 'Soạn email cho khách' : 'Soạn thư hỏi đối tác', 'primary', () => {
    editor.hidden = !editor.hidden;
    edit.setAttribute('aria-expanded', String(!editor.hidden));
    if (!editor.hidden) text.focus();
  });
  edit.setAttribute('aria-expanded', 'false');
  editor.id = 'email-draft-' + turns.children.length;
  edit.setAttribute('aria-controls', editor.id);
  text.addEventListener('input', () => { notice.textContent = ''; });
  actions.append(edit, button(answer.emailKind === 'reply' ? 'Sao chép email' : 'Sao chép thư xác nhận', 'ghost', copy));
  if (context.conflict) {
    actions.append(button('Đối chiếu hướng dẫn', 'ghost', event => {
      showSource(context, 0, event.currentTarget);
      const detail = byId('source-detail');
      detail.replaceChildren();
      for (const source of context.sources.filter(item => item.state === 'active')) {
        const card = element('article', 'source-sheet comparison');
        card.append(element('h3', '', source.title), element('p', 'source-location', source.anchor),
          element('blockquote', 'source-quote', source.quote));
        detail.append(card);
      }
    }));
  }
  editor.append(element('p', 'draft-label', 'Bản nháp email'), text);
  actions.append(notice);
  card.append(actions, editor);
}

function renderTurn(question, answer) {
  const turn = element('li', 'turn');
  const questionRow = element('div', 'question');
  questionRow.append(element('p', '', question));
  const card = element('article', 'answer');
  const heading = element('div', 'answer-header');
  const labels = { supported: 'Có căn cứ', partial: 'Còn mục cần xác nhận', missing: 'Cần bổ sung', conflict: 'Cần xác nhận' };
  const status = element('span', 'answer-status', labels[answer.kind]);
  status.dataset.state = answer.kind;
  heading.append(status, element('span', 'answer-scope', answer.scope));
  if (answer.simulation) heading.append(element('span', 'tag', 'Mô phỏng'));
  card.append(heading, element('h2', '', answer.title));
  if (!answer.sections) for (const paragraph of answer.body.split('\n\n')) card.append(element('p', 'answer-paragraph', paragraph));
  if (answer.notes?.length) {
    const notes = element('ul', 'answer-notes');
    for (const warning of answer.notes) notes.append(element('li', '', warning));
    card.append(notes);
  }
  const context = { sources: answer.citations, chips: [], conflict: answer.kind === 'conflict' };
  function citationsFor(ids) {
    const row = element('div', 'citations');
    for (const id of ids) {
      const i = context.sources.findIndex(item => item.id === id);
      const source = context.sources[i];
      if (!source) continue;
      const chip = button(sourceLabel(source, i) + (source.state === 'context' ? ' · Tham chiếu' : ''), 'cite',
        event => showSource(context, i, event.currentTarget));
      chip.setAttribute('aria-controls', 'evidence');
      context.chips.push({ chip, i });
      row.append(chip);
    }
    return row;
  }
  if (answer.sections) {
    for (const group of answer.sections) {
      const section = element('section', 'answer-section');
      section.append(element('h3', '', group.label));
      for (const paragraph of group.text.split('\n\n').filter(Boolean)) section.append(element('p', 'answer-paragraph', paragraph));
      if (group.missing) section.append(element('p', 'section-note', group.missing));
      if (group.ids.length) section.append(citationsFor(group.ids));
      card.append(section);
    }
  } else if (context.sources.length) card.append(citationsFor(context.sources.map(row => row.id)));
  if (answer.email) appendEmail(card, answer, context);
  else if (answer.kind === 'missing' && !answer.scope) {
    const actions = element('div', 'answer-actions suggestions');
    actions.append(button('Bổ sung câu hỏi', 'ghost', () => { query.value = question; query.focus(); }));
    card.append(actions);
  }
  if (answer.suggestions?.length) {
    const follow = element('div', 'follow-up');
    follow.setAttribute('aria-label', 'Hỏi tiếp');
    for (const suggestion of answer.suggestions) follow.append(button(suggestion, 'cite', () => {
      void ask(suggestion, answer.scopeKey);
    }));
    card.append(follow);
  }
  turn.append(questionRow, card);
  turns.append(turn);
  if (libraryMode) byId('intro').hidden = true;
  const item = element('li');
  const jump = button(question, '', () => {
    activeTurn?.removeAttribute('aria-current');
    activeTurn = jump;
    jump.setAttribute('aria-current', 'true');
    turn.scrollIntoView({ block: 'nearest' });
    showSource(context, 0);
  });
  item.append(jump);
  history.append(item);
  byId('history-empty').hidden = true;
  jump.click();
}

async function ask(question, previous = currentScope) {
  if (!question || submit.disabled) return;
  submit.disabled = true;
  feedback.textContent = 'Đang đối chiếu nguồn…';
  try {
    const endpoint = scenario === 'public' ? 'public' : libraryMode ? 'research' : 'ask';
    const answer = await request(endpoint, { query: question, scenario, previous });
    latestQuestion = question;
    previousForLatest = previous;
    currentScope = answer.scopeKey ?? undefined;
    renderTurn(question, answer);
    feedback.textContent = '';
    query.value = '';
  } catch (error) {
    feedback.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
}

byId('compose').addEventListener('submit', event => {
  event.preventDefault();
  void ask(query.value.trim());
});
query.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    byId('compose').requestSubmit();
  }
});
byId('new-chat').addEventListener('click', () => {
  if (submit.disabled) return;
  closeDailyPilot?.();
  closeEmailWorkspace?.();
  turns.replaceChildren();
  byId('intro').hidden = false;
  setDrawer(false);
  history.replaceChildren();
  byId('history-empty').hidden = false;
  latestQuestion = '';
  currentScope = undefined;
  previousForLatest = undefined;
  activeTurn = undefined;
  query.value = '';
  feedback.textContent = '';
  byId('source-tabs').replaceChildren();
  byId('source-detail').replaceChildren(element('p', 'empty-evidence', 'Chọn một dẫn chứng trong câu trả lời để mở đúng đoạn nguồn.'));
  byId('conversation-scroll').scrollTop = 0;
  query.focus();
});
byId('source-toggle').addEventListener('click', event => setDrawer(!evidence.classList.contains('drawer-open'), event.currentTarget));
byId('source-close').addEventListener('click', () => setDrawer(false));
byId('sign-out').addEventListener('click', async () => {
  try {
    const response = await fetch('/api/m5/session/logout', { method: 'POST' });
    if (!response.ok && response.status !== 401) throw new Error();
    location.replace('/advice/');
  } catch {
    feedback.textContent = 'Chưa đăng xuất được. Vui lòng thử lại.';
  }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && evidence.classList.contains('drawer-open')) setDrawer(false);
});

try {
  const embedded = JSON.parse(byId('advice-config')?.textContent ?? '{}');
  const config = preview?.config ?? (Array.isArray(embedded.prompts) ? embedded : await request('config'));
  libraryMode = Boolean(config.library);
  if (libraryMode) {
    const privateLibrary = config.library.private === true;
    byId('private-link').hidden = !privateLibrary;
    scenario = config.defaultScenario ?? 'library';
    document.querySelector('.shell').classList.add('is-library');
    byId('scope-text').textContent = config.library.documents + (privateLibrary ? ' nguồn đã duyệt' : ' nguồn Word và email mô phỏng');
    byId('compose-scope').textContent = privateLibrary ? 'Kho đã duyệt trên máy và nguồn công khai' : 'Chỉ nhập tình huống mô phỏng';
    byId('intro-title').textContent = 'Anh cần tra cứu việc gì?';
    byId('intro-description').textContent = 'Hỏi về một thủ tục, kiểm tra đoạn nguồn và soạn thư ngay trong cuộc hỏi đáp.';
  }
  function displaySourceMode() {
    const published = scenario === 'public';
    if (config.label) {
      byId('workspace-mode').textContent = published ? 'Nguồn công khai' : config.label;
      byId('workspace-mode').hidden = false;
    }
    if (config.library?.publicDocuments) {
      byId('scope-text').textContent = published ? config.library.publicProcedures ? 'Hai thủ tục chuyên sâu và nguồn công khai đã rà' : config.library.publicDocuments + ' nguồn công khai đã rà'
        : config.library.documents + ' nguồn Word và email mô phỏng';
      byId('compose-scope').textContent = published ? 'Nguồn công khai đã rà' : 'Chỉ nhập tình huống mô phỏng';
    }
  }
  if (config.emailWorkspace) {
    const { mountEmailWorkspace } = await import('/advice/email.mjs');
    closeEmailWorkspace = mountEmailWorkspace({ config: config.emailWorkspace, request, copyText, showSource, element, button });
    if (config.emailWorkspace.private) {
      const { mountDailyPilot } = await import('/advice/m18-pilot.mjs');
      closeDailyPilot = mountDailyPilot({ panel: byId('daily-pilot'), area: byId('conversation-scroll'),
        launcher: byId('daily-pilot-launcher'), owner: config.emailWorkspace.owner, element, button,
        openChat: () => byId('email-launcher').focus(), closeEmail: closeEmailWorkspace });
      byId('email-launcher').addEventListener('click', () => closeDailyPilot(), { capture: true });
    }
  }
  byId('sign-out').hidden = !config.signedIn;
  displaySourceMode();
  for (const sample of config.prompts) byId('prompts').append(button(sample, '', () => void ask(sample)));
  const scenarioOptions = byId('scenario-options');
  for (const option of config.scenarios) {
    const selector = button(option.label, '', () => {
      if (submit.disabled || option.id === scenario) return;
      scenario = option.id;
      for (const control of scenarioOptions.children) control.setAttribute('aria-pressed', String(control === selector));
      displaySourceMode();
      if (latestQuestion) void ask(latestQuestion, previousForLatest ?? null);
    });
    selector.setAttribute('aria-pressed', String(option.id === scenario));
    scenarioOptions.append(selector);
  }
  byId('scenarios').hidden = !config.scenarios.length;
  if (preview?.initialQuestion) {
    await ask(preview.initialQuestion);
    byId('conversation-scroll').scrollTop = 0;
  }
} catch (error) {
  feedback.textContent = error.message;
}
