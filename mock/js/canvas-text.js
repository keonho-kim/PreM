// Purpose: Commit plain-text edits without losing the next intended interaction.
// Pattern: Input boundary with escaped rendering, cancellation and focus restoration.
// Usage: Bound per editor render by canvas-editor.js using its abort signal.
// Related: mock/js/slide-commands.js, mock/js/canvas-format.js.
window.PuPuTyXModules.canvasText = ({
  sheet,
  ui,
  commands,
  current,
  key,
  select,
  syncTools,
  selection,
  signal,
}) => {
  const listen = (node, type, handler) => node.addEventListener(type, handler, { signal });
  document.addEventListener(
    'pointerdown',
    (event) => {
      const editing = sheet.querySelector('[contenteditable]:focus');
      const target = event.target.closest(
        '[data-action],[data-editor-tab],[data-editor-panel],a[href^="#"]',
      );
      if (!editing || !target || editing.contains(target) || event.button !== 0) return;
      const field = editing.dataset.editField;
      const stored = editing.dataset.objectText
        ? current().objects?.find((o) => o.id === editing.dataset.objectText)?.text
        : field === 'title'
          ? current().title
          : current().body[Number(field)];
      if (editing.innerText === stored) return;
      const id = target.id,
        action = target.dataset.action,
        index = target.dataset.index,
        asset = target.dataset.id,
        href = target.getAttribute('href'),
        panel = target.dataset.editorPanel;
      event.preventDefault();
      event.stopImmediatePropagation();
      editing.blur();
      if (href) {
        location.hash = href;
        return;
      }
      const selector = id
        ? '#' + CSS.escape(id)
        : panel
          ? `[data-editor-panel="${CSS.escape(panel)}"]`
          : `[data-action="${CSS.escape(action)}"]${index ? `[data-index="${CSS.escape(index)}"]` : ''}${asset ? `[data-id="${CSS.escape(asset)}"]` : ''}`;
      document.querySelector(selector)?.click();
    },
    { capture: true, signal },
  );
  for (const node of sheet.querySelectorAll('[data-edit-field], [data-object-text]')) {
    node.contentEditable = 'plaintext-only';
    node.setAttribute('role', 'textbox');
    node.setAttribute(
      'aria-label',
      node.dataset.editField === 'title' ? '슬라이드 제목' : '슬라이드 텍스트',
    );
    node.setAttribute('aria-multiline', 'true');
    let initial = '',
      cancelled = false;
    listen(node, 'focus', () => {
      initial = node.innerText;
      cancelled = false;
      ui.selectedText = node.dataset.editField ?? null;
      if (node.dataset.objectText) select(node.dataset.objectText);
      else {
        selection.choose('field:' + node.dataset.editField);
        syncTools();
      }
    });
    listen(node, 'keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancelled = true;
        node.textContent = initial;
        node.blur();
      }
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        node.blur();
      }
    });
    listen(node, 'paste', (event) => {
      event.preventDefault();
      const text = event.clipboardData.getData('text/plain').slice(0, 2000),
        selection = getSelection();
      if (!selection.rangeCount) return;
      const range = selection.getRangeAt(0);
      if (!node.contains(range.commonAncestorContainer)) return;
      range.deleteContents();
      const added = document.createTextNode(text);
      range.insertNode(added);
      range.setStartAfter(added);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    });
    listen(node, 'blur', (event) => {
      if (cancelled || signal.aborted || current().id !== key) return;
      const value = node.innerText.replace(/\r/g, '').slice(0, 2000);
      if (value === initial) return;
      const focusId = event.relatedTarget?.id;
      if (node.dataset.objectText) commands.object(node.dataset.objectText, { text: value });
      else commands.text(node.dataset.editField, value);
      if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
    });
  }
};
