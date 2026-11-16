// Purpose: Own tab-local bottom-right task presentation and short-lived mock notifications.
// Pattern: Stable shell outside route rendering; simulated tasks remain owned by their features.
// Usage: app.js supplies read-only task projections; no files or state are persisted.
// Related: mock/styles/feedback.css, space.js, workflow.js, app-events.js.
window.PuPuTyXModules.feedback = (capabilities) => {
  'use strict';
  const { $, esc, icon, readAssets, readRuns } = capabilities;
  const readTasks = () => [
    ...readAssets().map((item) => ({
      ...item,
      id: 'asset-' + item.id,
      key: item.id,
      source: 'asset',
      total: 3,
    })),
    ...readRuns()
      .filter((item) => item.sessionTask)
      .map((item) => ({
        ...item,
        name: item.title,
        source: 'generation',
        total: 6,
        href: '#' + new URLSearchParams({ view: 'presentations', project: item.projectId }),
      })),
  ];
  const dock = document.createElement('section');
  dock.className = 'mock-work-dock';
  dock.setAttribute('aria-label', '작업 진행 상황');
  dock.hidden = true;
  dock.innerHTML = `<button class="button mock-work-launcher" type="button" hidden>작업 보기</button><section class="mock-work-panel"><header><div><h2>작업 진행 상황</h2><p data-task-summary></p></div><button type="button" class="icon-button" data-task-toggle aria-label="작업 패널 접기" aria-expanded="true" aria-controls="mock-task-body">${icon('ChevronDown')}</button><button type="button" class="icon-button" data-task-close aria-label="작업 패널 닫기">${icon('X')}</button></header><div id="mock-task-body"><div class="mock-task-tools"><span>샘플 작업</span><button type="button" class="button quiet-button" data-task-clear>완료 항목 정리</button></div><ul></ul><p class="quiet small">샘플 체험 · 선택한 파일은 전송하지 않습니다.</p></div></section>`;
  const toasts = document.createElement('section');
  toasts.className = 'mock-toasts';
  toasts.setAttribute('aria-label', '알림');
  toasts.hidden = true;
  const nativePopover = typeof toasts.showPopover === 'function';
  if (nativePopover) toasts.setAttribute('popover', 'manual');
  document.body.append(dock, toasts);
  const panel = $('.mock-work-panel', dock),
    body = $('#mock-task-body', dock);
  const toggle = $('[data-task-toggle]', dock),
    launcher = $('.mock-work-launcher', dock);
  const cleared = new Set(),
    seen = new Set(),
    toastEntries = [],
    pending = [];
  let mode = 'expanded';
  const dialog = $('#app-dialog');
  const measure = () => {
    const height = dock.hidden ? 0 : dock.getBoundingClientRect().height;
    toasts.style.setProperty('--mock-task-height', height ? `${height + 12}px` : '0px');
    document.documentElement.style.setProperty(
      '--mock-work-reserve',
      height ? `${height + 12}px` : '0px',
    );
  };
  const resize = new ResizeObserver(measure);
  resize.observe(dock);
  function setMode(next, focus = false) {
    mode = next;
    launcher.hidden = mode !== 'hidden';
    panel.hidden = mode === 'hidden';
    body.hidden = mode !== 'expanded';
    toggle.setAttribute('aria-expanded', String(mode === 'expanded'));
    toggle.setAttribute('aria-label', mode === 'expanded' ? '작업 패널 접기' : '작업 패널 펼치기');
    toggle.innerHTML = icon(mode === 'expanded' ? 'ChevronDown' : 'ChevronUp');
    if (focus) (mode === 'hidden' ? launcher : toggle).focus();
    measure();
  }
  launcher.onclick = () => setMode('expanded', true);
  toggle.onclick = () => setMode(mode === 'expanded' ? 'collapsed' : 'expanded', true);
  $('[data-task-close]', dock).onclick = () => setMode('hidden', true);
  $('[data-task-clear]', dock).onclick = () => {
    for (const task of readTasks())
      if (['completed', 'cancelled'].includes(task.status)) cleared.add(task.id);
    renderTasks();
    if (dock.hidden) $('#main-title')?.focus();
  };
  function renderTasks() {
    const all = readTasks();
    for (const task of all)
      if (!['completed', 'cancelled'].includes(task.status)) cleared.delete(task.id);
    const tasks = all.filter((task) => !cleared.has(task.id));
    if (tasks.some((task) => !seen.has(task.id))) setMode('expanded');
    all.forEach((task) => seen.add(task.id));
    dock.hidden = !tasks.length;
    const done = tasks.filter((task) => task.status === 'completed').length;
    const running = tasks.filter((task) => task.status === 'running').length;
    $('[data-task-summary]', dock).textContent =
      `진행 ${running} · 완료 ${done} · 전체 ${tasks.length}`;
    launcher.textContent = `작업 ${tasks.length}개 보기`;
    $('[data-task-clear]', dock).disabled = !tasks.some((task) =>
      ['completed', 'cancelled'].includes(task.status),
    );
    const list = $('ul', dock);
    for (const node of [...list.children])
      if (!tasks.some((task) => task.id === node.dataset.taskId)) node.remove();
    for (const [index, task] of tasks.entries()) {
      let node = [...list.children].find((item) => item.dataset.taskId === task.id);
      if (!node) {
        node = document.createElement('li');
        node.dataset.taskId = task.id;
        node.innerHTML = `<div><strong></strong><span data-task-status></span><progress></progress></div>${task.source === 'asset' ? `<div class="mock-task-actions"><button class="button small-button" type="button" data-action="asset-toggle" data-id="${esc(task.key)}"></button><button class="icon-button" type="button" data-action="asset-cancel" data-id="${esc(task.key)}" aria-label="작업 취소">${icon('X')}</button></div>` : `<a href="${esc(task.href)}">작업 보기</a>`}`;
        list.insertBefore(node, list.children[index] ?? null);
      }
      $('strong', node).textContent = task.name;
      const terminal = ['completed', 'cancelled'].includes(task.status);
      $('[data-task-status]', node).textContent =
        task.status === 'completed'
          ? '준비 완료'
          : task.status === 'cancelled'
            ? '취소됨'
            : task.status === 'paused'
              ? '일시 정지'
              : `준비 중 · ${Math.round((task.step / task.total) * 100)}%`;
      const progress = $('progress', node);
      progress.max = task.total;
      progress.value = task.step;
      progress.hidden = terminal;
      progress.setAttribute('aria-label', task.name + ' 샘플 작업');
      const control = $('[data-action="asset-toggle"]', node);
      if (control) {
        control.textContent =
          task.status === 'running'
            ? '일시 정지'
            : task.status === 'cancelled'
              ? '다시 시작'
              : task.status === 'completed'
                ? '완료'
                : '이어가기';
        control.disabled = task.status === 'completed';
        $('[data-action="asset-cancel"]', node).disabled = terminal;
      }
    }
    measure();
  }
  function dismiss(entry) {
    clearTimeout(entry.timer);
    const focused = entry.node.contains(document.activeElement);
    entry.node.remove();
    const index = toastEntries.indexOf(entry);
    if (index >= 0) toastEntries.splice(index, 1);
    if (!toastEntries.length) {
      if (nativePopover) toasts.hidePopover();
      toasts.hidden = true;
    }
    if (focused) (entry.previous?.isConnected ? entry.previous : $('#main-title'))?.focus();
  }
  function show(text) {
    if (toastEntries.length >= 3) dismiss(toastEntries[0]);
    const node = document.createElement('div');
    node.className = 'mock-toast';
    node.innerHTML = `<p>${esc(text)}</p><button type="button" class="icon-button" aria-label="알림 닫기">${icon('X')}</button>`;
    const entry = { node, previous: document.activeElement, timer: null };
    const schedule = () => {
      clearTimeout(entry.timer);
      entry.timer = setTimeout(() => dismiss(entry), 5000);
    };
    node.onpointerenter = () => clearTimeout(entry.timer);
    node.onpointerleave = () => {
      if (!node.contains(document.activeElement)) schedule();
    };
    node.onfocusin = () => clearTimeout(entry.timer);
    node.onfocusout = (event) => {
      if (!node.contains(event.relatedTarget)) schedule();
    };
    $('button', node).onclick = () => dismiss(entry);
    toastEntries.push(entry);
    toasts.append(node);
    toasts.hidden = false;
    if (nativePopover) toasts.showPopover();
    $('#announcer').textContent = text;
    schedule();
  }
  function notify(text) {
    if (dialog.open) {
      pending.push(text);
      if (pending.length > 5) pending.shift();
    } else show(text);
  }
  const flush = () => pending.splice(0).forEach(show);
  dialog.addEventListener('close', flush);
  function reset() {
    toastEntries.slice().forEach(dismiss);
    pending.length = 0;
    cleared.clear();
    seen.clear();
    dock.hidden = true;
    setMode('expanded');
  }
  return {
    notify,
    renderTasks,
    reset,
    dispose() {
      reset();
      resize.disconnect();
      document.documentElement.style.removeProperty('--mock-work-reserve');
      dialog.removeEventListener('close', flush);
      dock.remove();
      toasts.remove();
    },
  };
};
