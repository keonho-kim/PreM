// Purpose: Support direct text editing, local image insertion and object geometry.
// Pattern: Rerender-scoped DOM gestures commit immutable snapshots only on completion.
// Usage: Owned by editor-support.js; image contents are read only after explicit selection.
// Related: mock/js/slide-commands.js, mock/js/ui.js, mock/styles/editor-interactions.css.
window.PuPuTyXModules.canvasEditor = ({ ui, deck, commands, announce, selection }) => {
  let release = () => {};
  const current = () => deck().slides[ui.slideIndex];
  function enhance() {
    release();
    const sheet = document.querySelector('.editor-stage .slide-sheet');
    if (!sheet) return;
    const events = new AbortController(),
      signal = events.signal,
      key = current().id,
      version = deck().version;
    let uploadToken = 0;
    let drag = null,
      reader = null;
    const notify = (text) => {
      const node = document.querySelector('#canvas-message');
      if (node) node.textContent = text;
      else announce(text);
    };
    const listen = (node, event, handler) => node?.addEventListener(event, handler, { signal });
    selection.read();
    function syncTools() {
      const object = current().objects?.find((o) => o.id === ui.selectedObject);
      const style = object ?? current().textStyles?.[ui.selectedText ?? 'title'] ?? {};
      for (const cmd of ['bold', 'italic'])
        document
          .querySelector(`[data-canvas-command="${cmd}"]`)
          ?.setAttribute('aria-pressed', String(!!style[cmd]));
      const remove = document.querySelector('[data-canvas-command="delete"]');
      if (remove) remove.disabled = !object;
      for (const button of document.querySelectorAll(
        '[data-canvas-command="bold"],[data-canvas-command="italic"],[data-canvas-command="larger"],[data-canvas-command="smaller"],[data-canvas-command^="align-"]',
      ))
        button.disabled = !!object && object.type !== 'text';
      const target =
        object?.type === 'text'
          ? sheet.querySelector(`[data-object-text="${object.id}"]`)
          : sheet.querySelector(`[data-edit-field="${ui.selectedText ?? 'title'}"]`);
      if (target)
        document
          .querySelector('[data-canvas-command="bold"]')
          ?.setAttribute(
            'aria-pressed',
            String(Number(getComputedStyle(target).fontWeight) >= 600),
          );
    }
    function select(id) {
      selection.choose(id ? 'object:' + id : null);
      syncTools();
    }
    sheet.addEventListener(
      'pointerdown',
      (event) => {
        const node = event.target.closest('[data-edit-field], [data-object-id]');
        if (node && (event.ctrlKey || event.metaKey) && event.button === 0) {
          event.preventDefault();
          event.stopImmediatePropagation();
          const editing = sheet.querySelector('[contenteditable]:focus');
          editing?.blur();
          selection.choose(
            node.dataset.objectId
              ? 'object:' + node.dataset.objectId
              : 'field:' + node.dataset.editField,
            true,
          );
          syncTools();
        } else if (!node && event.button === 0) select(null);
      },
      { capture: true, signal },
    );
    sheet.addEventListener(
      'mousedown',
      (event) => {
        if (event.ctrlKey || event.metaKey) event.preventDefault();
      },
      { capture: true, signal },
    );
    sheet.addEventListener(
      'contextmenu',
      (event) => {
        if (event.ctrlKey && event.target.closest('[data-edit-field],[data-object-id]'))
          event.preventDefault();
      },
      { signal },
    );
    window.PuPuTyXModules.canvasText({
      sheet,
      ui,
      commands,
      current,
      key,
      select,
      syncTools,
      selection,
      signal,
    });
    function stop(cancel = false) {
      if (!drag) return;
      const value = drag;
      drag = null;
      if (value.handle.hasPointerCapture(value.id)) value.handle.releasePointerCapture(value.id);
      if (cancel) {
        Object.assign(value.node.style, {
          left: value.old.x + 'px',
          top: value.old.y + 'px',
          width: value.old.w + 'px',
          height: value.old.h + 'px',
        });
        return;
      }
      if (value.changed && current().id === key) commands.object(value.old.id, value.next);
    }
    for (const node of sheet.querySelectorAll('[data-object-id]')) {
      node.tabIndex = 0;
      node.setAttribute(
        'aria-label',
        '삽입 요소: 클릭 선택, 방향키 이동, Alt와 방향키 크기 변경, Delete 삭제',
      );
      listen(node, 'focus', () => {
        if (!selection.read().includes('object:' + node.dataset.objectId))
          select(node.dataset.objectId);
      });
      listen(node, 'pointerdown', (event) => {
        if (event.button !== 0 || drag) return;
        select(node.dataset.objectId);
        if (
          event.target.closest('[contenteditable]') &&
          !event.target.closest('[data-object-move]')
        )
          return;
        event.preventDefault();
        node.focus({ preventScroll: true });
        const old = current().objects.find((o) => o.id === node.dataset.objectId);
        drag = {
          id: event.pointerId,
          handle: node,
          node,
          old: { ...old },
          next: {},
          x: event.clientX,
          y: event.clientY,
          scale: sheet.getBoundingClientRect().width / 960,
          resize: !!event.target.closest('[data-object-resize]'),
          changed: false,
        };
        node.setPointerCapture(event.pointerId);
      });
      listen(node, 'keydown', (event) => {
        if (event.target.isContentEditable) return;
        select(node.dataset.objectId);
        if (event.key === 'Delete' || event.key === 'Backspace') {
          event.preventDefault();
          commands.removeObject();
          return;
        }
        if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault();
        const old = current().objects.find((o) => o.id === node.dataset.objectId),
          step = event.shiftKey ? 10 : 1;
        const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0,
          dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
        commands.object(
          old.id,
          event.altKey
            ? {
                w: Math.max(24, Math.min(960 - old.x, old.w + dx)),
                h: Math.max(24, Math.min(540 - old.y, old.h + dy)),
              }
            : {
                x: Math.max(0, Math.min(960 - old.w, old.x + dx)),
                y: Math.max(0, Math.min(540 - old.h, old.y + dy)),
              },
        );
        document
          .querySelector(`.editor-stage [data-object-id="${old.id}"]`)
          ?.focus({ preventScroll: true });
      });
    }
    listen(document, 'pointermove', (event) => {
      if (!drag || drag.id !== event.pointerId) return;
      const { old, scale } = drag,
        dx = (event.clientX - drag.x) / scale,
        dy = (event.clientY - drag.y) / scale;
      const next = drag.resize
        ? {
            w: Math.max(24, Math.min(960 - old.x, old.w + dx)),
            h: Math.max(24, Math.min(540 - old.y, old.h + dy)),
          }
        : {
            x: Math.max(0, Math.min(960 - old.w, old.x + dx)),
            y: Math.max(0, Math.min(540 - old.h, old.y + dy)),
          };
      drag.next = next;
      drag.changed = Math.abs(dx) + Math.abs(dy) > 2;
      for (const [prop, value] of Object.entries(next))
        drag.node.style[{ x: 'left', y: 'top', w: 'width', h: 'height' }[prop]] = value + 'px';
    });
    listen(document, 'pointerup', (event) => {
      if (drag?.id === event.pointerId) stop();
    });
    listen(document, 'pointercancel', () => stop(true));
    listen(sheet, 'lostpointercapture', () => stop(true));
    const file = document.querySelector('#canvas-image-file');
    listen(file, 'change', async () => {
      const token = ++uploadToken;
      if (reader?.readyState === 1) reader.abort();
      const image = file.files?.[0];
      if (!image) return;
      if (
        !['image/png', 'image/jpeg', 'image/webp'].includes(image.type) ||
        image.size > 2 * 1024 * 1024
      ) {
        notify('PNG, JPEG, WebP 2 MiB 이하 이미지를 선택하세요.');
        file.value = '';
        return;
      }
      try {
        const bitmap = await createImageBitmap(image);
        const dimensions = { width: bitmap.width, height: bitmap.height };
        bitmap.close();
        if (dimensions.width * dimensions.height > 16000000)
          throw new Error('이미지는 1600만 화소 이하여야 합니다.');
        if (signal.aborted || token !== uploadToken) return;
        const src = await new Promise((resolve, reject) => {
          reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error('이미지를 읽지 못했습니다.'));
          reader.onabort = () => reject(new Error('cancelled'));
          reader.readAsDataURL(image);
        });
        if (
          signal.aborted ||
          token !== uploadToken ||
          current().id !== key ||
          deck().version !== version
        ) {
          announce('슬라이드가 변경되어 이미지 삽입을 취소했습니다.');
          return;
        }
        const w = Math.min(400, dimensions.width),
          h = Math.min(300, (w * dimensions.height) / dimensions.width);
        commands.addObject({
          type: 'image',
          src,
          alt: image.name,
          w: (h * dimensions.width) / dimensions.height,
          h,
        });
      } catch (error) {
        if (!signal.aborted) notify(error.message);
      } finally {
        file.value = '';
        reader = null;
      }
    });
    const format = window.PuPuTyXModules.canvasFormat({ ui, deck, commands, sheet });
    listen(document.querySelector('.editor-toolbar'), 'pointerdown', (event) => {
      if (event.target.closest('[data-canvas-command], #canvas-text-color')) event.preventDefault();
    });
    listen(document, 'click', (event) => {
      const button = event.target.closest('[data-canvas-command]');
      if (!button || button.disabled) return;
      const cmd = button.dataset.canvasCommand;
      const editing = sheet.querySelector('[contenteditable]:focus');
      if (editing && ['image', 'text', 'delete', 'undo', 'redo'].includes(cmd)) editing.blur();
      if (cmd === 'image') document.querySelector('#canvas-image-file').click();
      else if (cmd === 'text')
        commands.addObject({ type: 'text', text: '텍스트를 입력하세요', h: 80, fontSize: 28 });
      else if (cmd === 'delete') commands.removeObject();
      else if (cmd === 'undo') commands.undo();
      else if (cmd === 'redo') commands.redo();
      else if (['zoom-in', 'zoom-out', 'zoom-fit'].includes(cmd)) {
        ui.canvasZoom =
          cmd === 'zoom-fit'
            ? 1
            : Math.max(0.5, Math.min(2, (ui.canvasZoom ?? 1) + (cmd === 'zoom-in' ? 0.25 : -0.25)));
        document.querySelector('.editor-stage').style.setProperty('--canvas-zoom', ui.canvasZoom);
        document.querySelector('#canvas-zoom-value').textContent =
          Math.round(ui.canvasZoom * 100) + '%';
      } else if (cmd === 'shape') commands.addObject({ type: 'shape', w: 200, h: 120 });
      else if (cmd === 'front' || cmd === 'back') {
        const slides = JSON.parse(JSON.stringify(deck().slides)),
          slide = slides[ui.slideIndex],
          index = (slide.objects ?? []).findIndex((o) => o.id === ui.selectedObject);
        if (index < 0) return;
        const [object] = slide.objects.splice(index, 1);
        cmd === 'front' ? slide.objects.push(object) : slide.objects.unshift(object);
        slide.version++;
        commands.commit(slides, 'Layer order');
      } else format(cmd);
    });
    listen(document, 'keydown', (event) => {
      if (
        document.querySelector('dialog[open]') ||
        event.target.closest('input,textarea,[contenteditable]')
      )
        return;
      if (event.key === 'Escape') {
        stop(true);
        select(null);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        event.shiftKey ? commands.redo() : commands.undo();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        commands.redo();
      }
    });
    const colorInput = document.querySelector('#canvas-text-color');
    if (colorInput) {
      colorInput.value = getComputedStyle(sheet).getPropertyValue('--color-slide-ink').trim();
      listen(colorInput, 'change', (event) => format('color', event.target.value));
    }
    document.querySelector('.editor-stage').style.setProperty('--canvas-zoom', ui.canvasZoom ?? 1);
    selection.paint();
    syncTools();
    release = () => {
      stop(true);
      events.abort();
      if (reader?.readyState === 1) reader.abort();
    };
  }
  return { enhance, dispose: () => release() };
};
