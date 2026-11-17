// Purpose: Format escaped markup and provide native DOM operations.
// Pattern: Feature factory with an explicit application context.
// Usage: Registered before mock/app.js by mock/index.html.
// Related: mock/app.js, mock/index.html.
window.PreMModules = {};
window.PreMModules.dom = (context) => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);

  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const esc = (value) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
    );

  const clone = (value) => JSON.parse(JSON.stringify(value));

  const uid = () => 'mock-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  const icon = (name) =>
    '<svg class="icon" viewBox="0 0 24 24" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    (window.MockIcons[name] ?? window.MockIcons.FileText)
      .map(
        ([tag, attrs]) =>
          '<' +
          tag +
          ' ' +
          Object.entries(attrs)
            .map(([key, value]) => key + '="' + esc(value) + '"')
            .join(' ') +
          ' />',
      )
      .join('') +
    '</svg>';

  const button = (text, action, name, options = '') => {
    const compact =
      name &&
      [
        'outline-up',
        'outline-down',
        'rename-outline',
        'template-layouts',
        'deck-revisions',
        'export',
      ].includes(action);
    return `<button type="button" class="${compact ? 'icon-button' : 'button'}" data-action="${action}" ${compact ? `aria-label="${esc(text)}" title="${esc(text)}"` : ''} ${options}>${name ? icon(name) : ''}${compact ? `<span class="sr-only">${esc(text)}</span>` : esc(text)}</button>`;
  };

  const badge = (text, type = '') =>
    `<span class="badge ${type}">${type === 'good' ? icon('CircleCheck') : type === 'wait' ? icon('Clock') : ''}${esc(text)}</span>`;

  const formatDate = (value) =>
    new Intl.DateTimeFormat('ko-KR', {
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));

  const bytes = (value) =>
    value < 1024 * 1024
      ? Math.max(1, Math.round(value / 1024)) + ' KiB'
      : (value / (1024 * 1024)).toFixed(1) + ' MiB';
  function revealActiveStrips() {
    for (const strip of document.querySelectorAll('[data-active-scroll]')) {
      if (!strip.clientWidth) continue;
      const active = strip.querySelector(
        '[aria-current="page"], [aria-current="step"], [aria-pressed="true"]',
      );
      if (!active) continue;
      const frame = strip.getBoundingClientRect();
      const item = active.getBoundingClientRect();
      const left =
        item.left < frame.left ? item.left - frame.left : Math.max(0, item.right - frame.right);
      const top =
        item.top < frame.top ? item.top - frame.top : Math.max(0, item.bottom - frame.bottom);
      if (left || top) strip.scrollBy({ left, top, behavior: 'auto' });
    }
  }
  function readCanvasDraft() {
    const node = document.querySelector('.editor-stage [contenteditable]:focus');
    if (!node) return null;
    return {
      slideId: node.closest('[data-slide-id]').dataset.slideId,
      field: node.dataset.editField,
      objectId: node.dataset.objectText,
      text: node.innerText.slice(0, node.dataset.editField === 'title' ? 100 : 2000),
    };
  }
  return {
    $,
    $$,
    esc,
    clone,
    uid,
    icon,
    button,
    badge,
    formatDate,
    bytes,
    revealActiveStrips,
    readCanvasDraft,
  };
};
