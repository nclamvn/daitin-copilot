import { blindPilot, pilotOrder } from './pilot-rules.mjs';

function downloadJson(name, data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name + '.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function mountDailyPilot({ panel, area, launcher, owner, element, button, openChat, closeEmail }) {
  const key = 'daitin:daily-pilot:v1:' + owner;
  const blank = () => ({ entries: [], days: [], live: null });
  const load = () => JSON.parse(localStorage.getItem(key) ?? 'null') ?? blank();
  let state = load();
  const save = next => {
    const persisted = load();
    if (persisted.revision !== state.revision) throw new Error('Pilot vừa đổi ở tab khác. Mở lại màn hình đo.');
    next.revision = crypto.randomUUID();
    localStorage.setItem(key, JSON.stringify(next));
    state = next;
  };
  const tick = (live, now) => {
    const elapsed = live.since ? Math.max(0, now - live.since) : 0;
    return { ...live, activeMs: live.activeMs + (live.mode === 'active' ? elapsed : 0),
      waitMs: live.waitMs + (live.mode === 'wait' ? elapsed : 0), since: now };
  };
  const sessionResult = live => ({
    session: live.sessions,
    activeMs: live.activeMs - (live.firstSession?.activeMs ?? 0),
    waitMs: live.waitMs - (live.firstSession?.waitMs ?? 0),
    friction: live.friction?.trim() ?? '',
  });
  const replaceLive = update => save({ ...state, live: { ...state.live, ...update } });
  let clock;
  const hide = () => { clearInterval(clock); panel.hidden = true; area.classList.remove('email-open'); };
  const field = (title, node) => {
    const label = element('label', 'email-field', title);
    node.setAttribute('aria-label', title);
    label.append(node);
    return label;
  };
  const input = (type, value = '') => Object.assign(element('input'), { type, value });
  const option = (value, label) => Object.assign(element('option', '', label), { value });
  const armLabel = arm => arm === 'chatbot' ? 'Chatbot' : 'Cách làm hiện tại';
  const priorName = () => state.live ? state.live.caseId + ' · ' + armLabel(state.live.arm) : '';
  let status;
  const act = (name, style, run) => button(name, style, async () => {
    try { await run(); }
    catch (error) { status.textContent = error.message; }
  });
  function render() {
    clearInterval(clock);
    state = load();
    status = element('p', 'email-status');
    status.setAttribute('role', 'status');
    const head = element('header', 'email-head');
    head.append(element('h2', '', 'Đo thời gian xử lý thư'), act('Về chatbot', 'ghost', () => { hide(); openChat(); }));
    panel.replaceChildren(head, status);
    panel.hidden = false;
    area.classList.add('email-open');
    area.scrollTop = 0;
    const card = element('section', 'email-intake');
    panel.append(card);

    if (!state.live) {
      const caseId = element('select');
      for (let i = 1; i <= 12; i++) {
        const id = 'C' + String(i).padStart(2, '0');
        caseId.append(option(id, id));
      }
      const pending = Array.from(caseId.options).find(item => state.entries.filter(row => row.caseId === item.value).length < 2);
      if (pending) caseId.value = pending.value;
      const arm = element('select');
      arm.disabled = true;
      const updateOrder = () => {
        const remaining = pilotOrder(caseId.value).filter(item => !state.entries.some(row => row.caseId === caseId.value && row.arm === item));
        arm.replaceChildren(...remaining.slice(0, 1).map(item => option(item, armLabel(item))));
      };
      caseId.addEventListener('change', updateOrder);
      updateOrder();
      card.append(element('p', 'email-quiet', 'Mở thư sau khi bấm bắt đầu. Dừng khi có bản dùng được hoặc quyết định chuyển cách làm.'));
      card.append(field('Mã ca đối chứng', caseId), field('Cách làm', arm), act('Bắt đầu đo', 'primary', () => {
        if (!arm.value) throw new Error('Ca này đã đủ hai cách làm.');
        save({ ...state, live: { caseId: caseId.value, arm: arm.value, code: crypto.randomUUID().slice(0, 12),
          mode: 'active', since: Date.now(), activeMs: 0, waitMs: 0, sessions: 1 } });
        render();
      }));
    } else {
      const live = state.live;
      const minutes = ms => (ms / 60000).toFixed(1).replace('.', ',') + ' phút';
      const counter = element('p', 'email-quiet');
      card.append(element('h3', 'email-list-title', priorName()), counter);
      const updateClock = () => {
        const now = tick(live, Date.now());
        const current = sessionResult(now);
        counter.textContent = 'Phiên ' + live.sessions + ' · ' + {
          active: 'Đang đo thao tác', wait: 'Đang đo chờ', pause: 'Đang tạm dừng',
        }[live.mode] + ' · ' + minutes(current.activeMs) + ' thao tác, ' + minutes(current.waitMs) + ' chờ trong phiên';
      };
      updateClock();
      if (live.mode !== 'pause') clock = setInterval(updateClock, 1000);
      const controls = element('div', 'email-actions');
      const friction = element('textarea');
      friction.rows = 2;
      friction.maxLength = 600;
      friction.value = live.friction ?? '';
      friction.addEventListener('input', () => {
        try { replaceLive({ friction: friction.value }); }
        catch (error) { status.textContent = error.message; }
      });
      const mode = (next, nextSession = false) => {
        const updated = { ...tick(state.live, Date.now()), friction: friction.value };
        replaceLive({ ...updated, mode: next, ...(nextSession ? { sessions: 2, firstSession: sessionResult(updated), friction: '' } : {}) });
        render();
      };
      if (live.mode !== 'active') controls.append(act('Tiếp tục thao tác', 'primary', () => mode('active')));
      if (live.mode !== 'wait') controls.append(act('Chờ hệ thống hoặc đối tác', 'ghost', () => mode('wait')));
      if (live.mode !== 'pause') controls.append(act('Tạm dừng', 'ghost', () => mode('pause')));
      if (live.sessions === 1 && live.mode !== 'active') controls.append(act('Bắt đầu phiên 2', 'ghost', () => mode('active', true)));
      card.append(controls);
      friction.placeholder = 'Bước gặp vướng, ảnh hưởng và cách xử lý';
      card.append(field('Chỗ vướng trong phiên', friction));
      if (live.firstSession) {
        const first = live.firstSession;
        card.append(element('p', 'email-quiet', 'Phiên 1 · ' + minutes(first.activeMs) + ' thao tác, ' + minutes(first.waitMs) +
          ' chờ' + (first.friction ? ' · ' + first.friction : '')));
      }
      const client = element('textarea');
      const partner = element('textarea');
      const evidence = element('textarea');
      for (const box of [client, partner, evidence]) box.rows = 3;
      const details = element('details', 'email-transcript');
      details.open = live.mode !== 'active';
      details.append(element('summary', '', 'Bản cuối và căn cứ'), field('Thư khách đã duyệt', client),
        field('Thư xác nhận đã duyệt', partner), field('Mã đoạn, ngày hoặc vị trí nguồn để người chấm mở', evidence));
      const outcome = element('select');
      outcome.append(option('done', 'Đã có bản dùng được'), option('fallback', 'Chuyển sang cách làm khác'),
        option('stopped', 'Dừng hoặc chưa đủ kết quả'));
      const reason = input('text');
      reason.maxLength = 240;
      const finish = act('Lưu kết quả ca', 'primary', () => {
        if (live.mode !== 'pause') throw new Error('Tạm dừng đồng hồ trước khi ghi kết quả.');
        const draft = { client: client.value.trim(), partner: partner.value.trim() };
        const sources = evidence.value.split('\n').map(item => item.trim()).filter(Boolean);
        if (outcome.value === 'done' && (!(draft.client || draft.partner) || !sources.length)) throw new Error('Dán bản cuối và ghi căn cứ để người chấm đối chiếu.');
        if (outcome.value !== 'done' && !reason.value.trim()) throw new Error('Ghi lý do dừng hoặc đổi cách làm.');
        const final = { ...tick(state.live, Date.now()), friction: friction.value };
        const { caseId, arm, code, activeMs, waitMs, sessions, firstSession } = final;
        const perSession = firstSession ? [firstSession, sessionResult(final)] : [sessionResult(final)];
        const result = { caseId, arm, code, activeMs, waitMs, sessions };
        save({ ...state, live: null, entries: [...state.entries, { ...result, perSession, draft, evidence: sources,
          outcome: outcome.value, reason: reason.value.trim() }] });
        render();
      });
      const excluded = element('p', 'email-quiet', 'Dừng đồng hồ ngay khi có bản cuối, rồi dán bản vào phiếu.');
      details.append(excluded, field('Kết quả', outcome), field('Lý do nếu dừng hoặc chuyển cách', reason), finish);
      card.append(details);
    }
    const daily = element('details', 'email-transcript');
    daily.append(element('summary', '', 'Nhật ký 10 ngày · ' + state.days.length + '/10'));
    const date = input('date', new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).format());
    const eligible = input('number', '0');
    const started = input('number', '0');
    const fallback = input('number', '0');
    for (const count of [eligible, started, fallback]) count.min = '0';
    const reason = input('text');
    reason.maxLength = 240;
    function loadDay() {
      const day = state.days.find(row => row.date === date.value);
      eligible.value = day?.eligible ?? 0;
      started.value = day?.started ?? 0;
      fallback.value = day?.fallback ?? 0;
      reason.value = day?.reason ?? '';
    }
    date.addEventListener('change', loadDay);
    loadDay();
    daily.append(field('Ngày làm việc', date), field('Tổng thư đủ điều kiện', eligible),
      field('Đã chọn chatbot', started), field('Quay về cách làm cũ sau khi thử', fallback), field('Lý do bỏ qua hoặc quay về', reason),
      act('Lưu nhật ký ngày', 'primary', () => {
        const counts = [eligible, started, fallback].map(control => Number(control.value));
        if (!date.value || counts.some(n => !Number.isSafeInteger(n) || n < 0) || counts[2] > counts[1] || counts[1] > counts[0] ||
            ((counts[2] || counts[0] > counts[1]) && !reason.value.trim())) throw new Error('Kiểm số lượng thư và ghi lý do nếu có ca bỏ qua.');
        const days = state.days.filter(row => row.date !== date.value);
        if (days.length >= 10) throw new Error('Pilot đã có 10 ngày được ghi.');
        save({ ...state, days: [...days, { date: date.value, eligible: counts[0], started: counts[1], fallback: counts[2], reason: reason.value.trim() }] });
        render();
      }));
    panel.append(daily);
    const exports = element('div', 'email-actions');
    exports.append(act('Tải nhật ký điều phối', 'ghost', () => downloadJson('m18-dieu-phoi', state)),
      act('Tải bản chấm mù', 'ghost', () => downloadJson('m18-cham-mu', blindPilot(state.entries))));
    panel.append(element('p', 'email-quiet', state.entries.length + '/24 lượt đối chứng đã lưu'), exports);
  }

  launcher.hidden = false;
  launcher.addEventListener('click', () => { closeEmail(); render(); });
  return hide;
}
