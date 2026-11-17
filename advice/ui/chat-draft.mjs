const revision = () => crypto.randomUUID();

export function reviseDraft(previous, proposal) {
  const sections = proposal.sections.map(section => {
    const saved = previous?.sections.find(item => item.id === section.id && item.fingerprint === section.fingerprint);
    return { ...section, draft: saved?.draft ?? section.text, approved: saved?.approved ?? false };
  });
  const snapshot = previous && { version: previous.version, sections: previous.sections.map(({ title, draft, approved }) => ({ title, draft, approved })) };
  const history = snapshot ? [...(previous.history ?? []), snapshot].slice(-5) : [];
  return { ...proposal, sections, history, version: (previous?.version ?? 0) + 1, revision: revision() };
}

export function composeReviewedMail(record, pending) {
  const sections = record.sections.filter(section => section.pending === pending);
  if (!sections.length || sections.some(section => !section.approved || !section.draft.trim())) return '';
  return 'Chào anh/chị,\n\n' + sections.map(section => section.title + '\n' + section.draft.trim()).join('\n\n') + '\n\nTrân trọng,';
}

export function mountChatDraft({ config, request, copyText, showSource, element, button }) {
  const key = 'daitin:chat-draft:v1:' + config.owner;
  const panel = document.getElementById('chat-draft');
  let saved, busy = false;
  const read = () => {
    const record = JSON.parse(localStorage.getItem(key) ?? 'null');
    return record?.sections?.length && Array.isArray(record.inputs) ? record : null;
  };
  try { saved = read(); } catch { saved = null; }
  const launcher = document.getElementById('chat-draft-launcher');
  launcher.hidden = !saved;
  const show = () => {
    panel.hidden = false;
    panel.scrollIntoView({ block: 'nearest' });
  };
  launcher.addEventListener('click', () => { if (saved) show(); });
  function commit(record) {
    const current = read();
    if ((current?.revision ?? null) !== (saved?.revision ?? null)) throw Error('Bản thư đã đổi ở tab khác. Tải lại trang để tiếp tục.');
    if (record) localStorage.setItem(key, JSON.stringify(record));
    else localStorage.removeItem(key);
    saved = record;
    launcher.hidden = !saved;
  }

  function draw() {
    panel.replaceChildren();
    if (!saved) { panel.hidden = true; return; }
    const header = element('div', 'chat-draft-header');
    header.append(element('h2', '', 'Duyệt bản thư'), element('span', 'tag', 'Bản ' + saved.version));
    header.append(button('Thu gọn', 'ghost', () => { panel.hidden = true; launcher.focus(); }));
    panel.append(header);
    if (saved.hold) panel.append(element('p', 'section-note', 'Có nội dung đính chính chưa xác định được thủ tục. Hỏi lại với tên thủ tục để cập nhật bản thư.'));
    if (saved.history?.length) {
      const history = element('details', 'chat-draft-history');
      history.append(element('summary', '', 'Xem các bản trước'));
      for (const version of [...saved.history].reverse()) {
        const item = element('details');
        item.append(element('summary', '', 'Bản ' + version.version));
        for (const section of version.sections) {
          item.append(element('h3', '', section.title), element('p', 'answer-paragraph', section.draft),
            element('small', '', section.approved ? 'Đã rà ở phiên bản này' : 'Chưa rà ở phiên bản này'));
        }
        history.append(item);
      }
      panel.append(history);
    }
    const status = element('p', 'copy-note');
    status.setAttribute('role', 'status');
    const actions = element('div', 'answer-actions');
    const copyControls = [];
    function copyButton(pending) {
      const action = pending ? 'Sao chép thư xác nhận' : 'Sao chép thư khách';
      const copy = button(action, pending ? 'ghost' : 'primary', async () => {
        if (busy) return;
        const approveIndex = copy.dataset.approveIndex;
        if (approveIndex !== undefined) {
          try {
            const sections = saved.sections.map((section, index) => (index === Number(approveIndex) ? { ...section, approved: true } : section));
            commit({ ...saved, sections, revision: revision() });
            panel.querySelectorAll('.chat-approve input')[Number(approveIndex)].checked = true;
            refreshCopyControls();
          } catch (error) { status.textContent = error.message; return; }
        }
        const approved = saved;
        if (approved.hold) { status.textContent = 'Xác nhận thủ tục của phần đính chính trước khi sao chép.'; return; }
        const text = composeReviewedMail(approved, pending);
        if (!text) { status.textContent = 'Duyệt các mục trong thư này trước khi sao chép.'; return; }
        busy = true;
        status.textContent = 'Đang kiểm lại căn cứ…';
        try {
          const latest = await request('chat-draft', approved.inputs);
          if (saved?.revision !== approved.revision || read()?.revision !== approved.revision) throw Error('Bản thư vừa thay đổi. Mở bản mới để kiểm lại.');
          if (latest.sections.length !== approved.sections.length ||
              latest.sections.some(section => !approved.sections.some(item => item.id === section.id && item.fingerprint === section.fingerprint))) {
            commit(reviseDraft(approved, latest));
            draw();
            panel.querySelector('[role="status"]').textContent = 'Căn cứ đã đổi. Các mục bị ảnh hưởng cần duyệt lại.';
            return;
          }
          status.textContent = await copyText(text) ? 'Đã sao chép bản ' + approved.version + '.' : 'Trình duyệt chưa cho sao chép.';
        } catch (error) { status.textContent = error.message; }
        finally { busy = false; }
      });
      copyControls.push({ pending, copy });
      return copy;
    }
    function refreshCopyControls() {
      for (const { pending, copy } of copyControls) {
        const open = saved.sections.filter(section => section.pending === pending && !section.approved);
        if (open.length === 1 && open[0].draft.trim() && !saved.hold) {
          const index = saved.sections.indexOf(open[0]);
          copy.textContent = 'Duyệt mục còn lại và ' + (pending ? 'sao chép thư xác nhận' : 'sao chép thư khách');
          copy.setAttribute('aria-label', 'Duyệt ' + open[0].title + ' và ' + (pending ? 'sao chép thư xác nhận' : 'sao chép thư khách'));
          copy.dataset.approveIndex = String(index);
        } else {
          copy.textContent = pending ? 'Sao chép thư xác nhận' : 'Sao chép thư khách';
          copy.removeAttribute('aria-label');
          delete copy.dataset.approveIndex;
        }
      }
    }
    for (const [index, section] of saved.sections.entries()) {
      const item = element('section', 'chat-draft-item');
      const title = element('label', '', section.title);
      const input = element('textarea', 'draft-text');
      input.id = 'chat-draft-item-' + index;
      input.rows = 3;
      input.maxLength = 5000;
      title.htmlFor = input.id;
      input.value = section.draft;
      const approval = element('input');
      approval.type = 'checkbox';
      approval.checked = section.approved;
      const approveLabel = element('label', 'chat-approve', section.pending ? 'Đã rà câu cần xác nhận' : 'Đã rà mục này');
      approveLabel.prepend(approval);
      item.append(title);
      if (section.sources.length) {
        const references = element('div', 'chat-draft-references');
        const context = { sources: section.sources, chips: [] };
        for (const [i, source] of section.sources.entries()) {
          const chip = button(source.state === 'superseded' ? 'Nguồn đã thay thế' : source.title, 'cite', event =>
            showSource(context, i, event.currentTarget));
          chip.setAttribute('aria-controls', 'evidence');
          context.chips.push({ chip, i });
          references.append(chip);
        }
        item.append(references);
      }
      item.append(input, approveLabel);
      panel.append(item);
      const update = (value, approved) => {
        try {
          const sections = saved.sections.map((other, i) => i === index ? { ...other, draft: value, approved } : other);
          commit({ ...saved, sections, revision: revision() });
          status.textContent = '';
          refreshCopyControls();
        } catch (error) { status.textContent = error.message; return false; }
        return true;
      };
      input.addEventListener('input', () => {
        approval.checked = false;
        update(input.value, false);
      });
      approval.addEventListener('change', () => {
        if (approval.checked && !input.value.trim()) { approval.checked = false; return; }
        if (!update(input.value, approval.checked)) approval.checked = false;
      });
    }
    if (saved.sections.some(section => !section.pending)) actions.append(copyButton(false));
    if (saved.sections.some(section => section.pending)) actions.append(copyButton(true));
    panel.append(actions, status);
    refreshCopyControls();
  }

  draw();
  return {
    inputs: () => saved?.inputs ?? [],
    install(proposal, previous) {
      if (!proposal) return;
      const extendsDraft = previous.length > 0 && proposal.inputs.some(input => previous.some(item => item.topic === input.topic));
      commit(reviseDraft(extendsDraft ? saved : null, proposal));
      draw();
    },
    hold() {
      if (!saved) return;
      commit({ ...saved, hold: true, revision: revision() });
      draw();
    },
    open: show,
    close: () => { panel.hidden = true; },
    reset: () => { commit(null); draw(); },
  };
}
