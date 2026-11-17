// Purpose: Own slide-scoped chat drafts, messages and revision-pinned proposals.
// Pattern: In-memory sessions with inline review and explicit immutable commit.
// Usage: Rendered by presentations; enhanced alongside the canvas and inspector.
// Related: editor-selection.js, chat-patch.js, styles/editor-chat.css.
window.PreMModules.editorChat = ({ ui, deck, selection, commands, esc, icon, announce }) => {
  const sessions = new WeakMap();
  let events;
  const current = () => deck().slides[ui.slideIndex];
  function session() {
    const owner = deck();
    if (!sessions.has(owner)) sessions.set(owner, new Map());
    const all = sessions.get(owner),
      id = current().id;
    if (!all.has(id)) all.set(id, { draft: '', messages: [] });
    return all.get(id);
  }
  function targetLabel(keys = selection.read()) {
    return keys.length
      ? keys.length > 1
        ? `${keys.length}개 요소 · ${keys.map(selection.label).join(', ')}`
        : selection.label(keys[0])
      : '현재 슬라이드';
  }
  function messages() {
    return session()
      .messages.map(
        (m, i) =>
          `<article class="chat-message ${m.role}"><span class="chat-author">${m.role === 'user' ? '나' : 'PreM'}</span>${m.target ? `<small class="chat-message-target">${esc(m.target)}</small>` : ''}<p>${esc(m.text)}</p>${m.patch ? `<div class="chat-proposal">${m.patch.changes.map((c) => `<div class="chat-change"><strong>${esc(c.label)}</strong><del>${esc(c.before)}</del><ins>${esc(c.after)}</ins></div>`).join('')}${m.status === 'pending' ? `<div class="actions"><button type="button" class="button primary" data-chat-apply="${i}">${icon('Check')}적용</button><button type="button" class="button quiet-button" data-chat-discard="${i}">취소</button></div>` : `<span class="chat-result">${esc(m.status)}</span>`}</div>` : ''}</article>`,
      )
      .join('');
  }
  function view() {
    return `<section id="editor-chat-panel" class="chat-panel" role="tabpanel" aria-labelledby="editor-chat-tab" ${ui.editorTab === 'references' ? 'hidden' : ''}>
      <div class="chat-thread" role="log" aria-label="현재 슬라이드 AI 대화" aria-relevant="additions text" tabindex="0"><div class="chat-welcome"><strong>어떻게 다듬을까요?</strong><p>슬라이드의 요소를 선택하고 원하는 수정을 이야기하세요.</p><p class="quiet small">Ctrl / ⌘ + 클릭으로 여러 요소 선택</p></div><div id="chat-messages">${messages()}</div></div>
      <form data-form="chat" class="chat-composer" method="post" action="#" aria-label="AI에게 메시지 보내기"><div class="chat-target"><span>${icon('Square')}<span id="chat-target-label" role="status"></span></span><button id="chat-clear-selection" type="button" class="icon-button" aria-label="요소 선택 해제" title="요소 선택 해제">${icon('X')}</button></div><label class="sr-only" for="edit-instruction">수정할 내용</label><textarea id="edit-instruction" name="instruction" required maxlength="600" rows="3" placeholder="어떻게 바꿀까요?" aria-describedby="chat-help">${esc(session().draft)}</textarea><div class="chat-compose-footer"><span>Shift + Enter 줄바꿈</span><button type="submit" class="icon-button chat-send" aria-label="메시지 보내기" title="메시지 보내기">${icon('ArrowUp')}</button></div></form><p id="chat-help" class="chat-disclaimer">샘플 응답 · 실제 AI 응답은 아닙니다</p></section>`;
  }
  function syncSelection() {
    const label = document.getElementById('chat-target-label');
    if (!label) return;
    label.textContent = targetLabel();
    document.getElementById('chat-clear-selection').hidden = !selection.read().length;
  }
  function refreshMessages() {
    const node = document.getElementById('chat-messages');
    if (!node) return;
    node.innerHTML = messages();
    const thread = node.closest('.chat-thread');
    thread.scrollTop = thread.scrollHeight;
  }
  function submit(instruction) {
    if (!instruction.trim()) return;
    const s = session(),
      keys = selection.read(),
      target = targetLabel(keys);
    s.messages.push({ role: 'user', text: instruction, target });
    const patch = window.PreMModules.chatPatch(current(), keys, instruction);
    patch.changes.forEach((change) => {
      change.label = selection.label(change.key);
    });
    s.messages.push({
      role: 'assistant',
      target,
      text: patch.changes.length
        ? `${patch.changes.length}개 요소의 수정안이에요. 확인 후 적용해 주세요.${patch.skipped ? ` 나머지 ${patch.skipped}개 요소는 변경하지 않았어요.` : ''}`
        : '이 요청으로 변경할 수 있는 내용이 없어요. 텍스트는 “바꿀 문구”, ‘짧게’, ‘굵게’를, 이미지·도형은 ‘크게’ 또는 ‘오른쪽으로’를 요청해 보세요. 샘플 체험에서는 이런 수정 요청을 사용할 수 있어요.',
      ...(patch.changes.length
        ? { patch, version: deck().version, slideId: current().id, status: 'pending' }
        : {}),
    });
    s.draft = '';
    document.getElementById('edit-instruction').value = '';
    refreshMessages();
    document.getElementById('edit-instruction').focus();
  }
  function enhance() {
    dispose();
    const panel = document.getElementById('editor-chat-panel');
    if (!panel) return;
    events = new AbortController();
    const signal = events.signal,
      input = panel.querySelector('textarea'),
      s = session();
    input.addEventListener(
      'input',
      () => {
        s.draft = input.value;
        input.setCustomValidity('');
      },
      { signal },
    );
    input.addEventListener(
      'keydown',
      (event) => {
        if (event.key !== 'Enter' || event.shiftKey) return;
        if (event.isComposing || event.keyCode === 229) return;
        event.preventDefault();
        input.form.requestSubmit();
      },
      { signal },
    );
    panel.addEventListener(
      'click',
      (event) => {
        if (event.target.closest('#chat-clear-selection')) {
          selection.choose(null);
          input.focus();
          return;
        }
        const button = event.target.closest('[data-chat-apply],[data-chat-discard]');
        if (!button) return;
        const m = s.messages[Number(button.dataset.chatApply ?? button.dataset.chatDiscard)];
        if (!m?.patch || m.status !== 'pending') return;
        if (button.dataset.chatDiscard !== undefined) {
          m.status = '취소됨';
          refreshMessages();
          input.focus();
          return;
        }
        if (m.version !== deck().version || m.slideId !== current().id) {
          m.status = '슬라이드가 변경되어 적용할 수 없어요. 다시 요청해 주세요.';
          refreshMessages();
          announce(m.status);
          input.focus();
          return;
        }
        const slides = structuredClone(deck().slides);
        slides[ui.slideIndex] = structuredClone(m.patch.slide);
        m.status = '적용됨';
        commands.commit(slides, '선택 범위 AI 수정안 적용');
        document.getElementById('edit-instruction')?.focus();
      },
      { signal },
    );
    syncSelection();
    const thread = panel.querySelector('.chat-thread');
    thread.scrollTop = thread.scrollHeight;
  }
  function dispose() {
    events?.abort();
  }
  selection.onChange(syncSelection);
  return { view, submit, enhance, dispose };
};
