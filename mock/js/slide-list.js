// Purpose: Own slide context menus, insertion markers and pointer reordering.
// Pattern: DOM adapter committing once on drop; all listeners and frames are disposable.
// Usage: Enhanced after each editor render by editor-support.js.
// Related: mock/js/slide-commands.js, mock/styles/editor-interactions.css.
window.PreMModules.slideList = ({ ui, deck, commands, icon, announce }) => {
  let release = () => {};
  function enhance() {
    release();
    const rail = document.querySelector('#editor-slides .slide-rail');
    if (!rail) return;
    const events = new AbortController(),
      signal = events.signal;
    const rows = () => [...rail.querySelectorAll('[data-slide-index]')];
    let drag = null,
      frame = 0,
      insertion = 0,
      origin = null;
    const menu = document.createElement('div');
    menu.className = 'slide-context-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', '슬라이드 편집');
    const native = 'showPopover' in HTMLElement.prototype;
    if (native) menu.setAttribute('popover', 'auto');
    else menu.hidden = true;
    rail.after(menu);
    const horizontal = () => getComputedStyle(rail).flexDirection === 'row';
    function clear() {
      rail.removeAttribute('data-drop');
    }
    function spot(event) {
      const list = rows(),
        horizontalAxis = horizontal(),
        bounds = rail.getBoundingClientRect(),
        point = Math.max(
          horizontalAxis ? bounds.left : bounds.top,
          Math.min(
            horizontalAxis ? bounds.right : bounds.bottom,
            horizontalAxis ? event.clientX : event.clientY,
          ),
        );
      let at = list.findIndex((row) => {
        const r = row.getBoundingClientRect();
        return point < (horizontalAxis ? r.left + r.width / 2 : r.top + r.height / 2);
      });
      if (at < 0) at = list.length;
      insertion = at;
      const next = list[at]?.getBoundingClientRect(),
        previous = list[at - 1]?.getBoundingClientRect(),
        r = rail.getBoundingClientRect();
      const y =
        next && previous
          ? (next.top + previous.bottom) / 2
          : (next?.top ?? previous?.bottom ?? r.top);
      const x =
        next && previous
          ? (next.left + previous.right) / 2
          : (next?.left ?? previous?.right ?? r.left);
      rail.style.setProperty('--drop-x', (horizontalAxis ? x : r.left + 4) + 'px');
      rail.style.setProperty('--drop-y', (horizontalAxis ? r.top + 4 : y) + 'px');
      rail.style.setProperty('--drop-w', (horizontalAxis ? 2 : r.width - 16) + 'px');
      rail.style.setProperty('--drop-h', (horizontalAxis ? r.height - 12 : 2) + 'px');
      rail.dataset.drop = '';
      return at;
    }
    function close(restore = true) {
      if (native) {
        if (menu.matches(':popover-open')) menu.hidePopover();
      } else menu.hidden = true;
      clear();
      if (restore && origin?.isConnected) origin.focus({ preventScroll: true });
    }
    function open(event, index = null) {
      event.preventDefault();
      origin =
        event.target.closest('button') ?? rail.querySelector('.slide-thumb[aria-pressed="true"]');
      const at = index === null ? spot(event) : index + 1;
      const choices =
        index === null
          ? [['insert', 'Plus', '여기에 새 슬라이드', false]]
          : [
              ['insert', 'Plus', '아래에 새 슬라이드', false],
              ['duplicate', 'Copy', '복제', false],
              ['delete', 'Trash2', '삭제', deck().slides.length <= 1],
              ['up', 'ArrowUp', '앞으로 이동', index === 0],
              ['down', 'ArrowDown', '뒤로 이동', index === deck().slides.length - 1],
            ];
      menu.innerHTML = choices
        .map(
          ([cmd, name, label, disabled]) =>
            `<button type="button" role="menuitem" tabindex="-1" data-menu-cmd="${cmd}" ${disabled ? 'disabled' : ''}>${icon(name)}${label}</button>`,
        )
        .join('');
      menu.dataset.index = index === null ? '' : index;
      menu.dataset.at = at;
      if (native) menu.showPopover();
      else menu.hidden = false;
      const r = menu.getBoundingClientRect(),
        anchor = origin?.getBoundingClientRect();
      menu.style.left =
        Math.max(8, Math.min(event.clientX || anchor?.right || 8, innerWidth - r.width - 8)) + 'px';
      menu.style.top =
        Math.max(8, Math.min(event.clientY || anchor?.bottom || 8, innerHeight - r.height - 8)) +
        'px';
      if (event.type === 'keydown' || (event.detail === 0 && event.type === 'click'))
        menu.querySelector('button:not(:disabled)')?.focus();
    }
    menu.addEventListener('pointerdown', (event) => event.preventDefault(), { signal });
    menu.addEventListener(
      'toggle',
      (event) => {
        if (origin?.hasAttribute('aria-haspopup'))
          origin.setAttribute('aria-expanded', String(event.newState === 'open'));
        if (event.newState === 'closed') clear();
      },
      { signal },
    );
    menu.addEventListener(
      'click',
      (event) => {
        const button = event.target.closest('[data-menu-cmd]');
        if (!button || button.disabled) return;
        const index = Number(menu.dataset.index),
          at = Number(menu.dataset.at);
        close(false);
        const actions = {
          insert: () => commands.insert(at),
          duplicate: () => commands.duplicate(index),
          delete: () => commands.remove(index),
          up: () => commands.move(index, index - 1),
          down: () => commands.move(index, index + 2),
        };
        actions[button.dataset.menuCmd]?.();
      },
      { signal },
    );
    menu.addEventListener(
      'keydown',
      (event) => {
        const items = [...menu.querySelectorAll('button:not(:disabled)')],
          i = items.indexOf(document.activeElement);
        if (event.key === 'Escape' || event.key === 'Tab') {
          close();
          if (event.key === 'Escape') event.preventDefault();
          return;
        }
        if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        items[
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? items.length - 1
              : (i + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
        ]?.focus();
      },
      { signal },
    );
    document.addEventListener(
      'pointerdown',
      (event) => {
        if (!menu.contains(event.target) && !rail.contains(event.target)) close(false);
      },
      { signal },
    );
    rail.addEventListener(
      'contextmenu',
      (event) =>
        open(
          event,
          event.target.closest('[data-slide-index]')
            ? Number(event.target.closest('[data-slide-index]').dataset.slideIndex)
            : null,
        ),
      { signal },
    );
    rail.addEventListener(
      'click',
      (event) => {
        const button = event.target.closest('[data-slide-menu]');
        if (button) open(event, Number(button.dataset.slideMenu));
      },
      { signal },
    );
    rail.addEventListener(
      'keydown',
      (event) => {
        const row = event.target.closest('[data-slide-index]');
        if (!row) return;
        const index = Number(row.dataset.slideIndex);
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd') {
          event.preventDefault();
          commands.duplicate(index);
        }
        if (event.key === 'Delete' || event.key === 'Backspace') {
          event.preventDefault();
          commands.remove(index);
        }

        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))
          open(event, index);
        if (
          event.altKey &&
          ['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'].includes(event.key)
        ) {
          event.preventDefault();
          commands.move(index, index + (['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 2));
        }
      },
      { signal },
    );
    rail.addEventListener(
      'pointermove',
      (event) => {
        if (
          !drag &&
          !event.target.closest('[data-slide-index]') &&
          !event.target.closest('.rail-heading')
        )
          spot(event);
        else if (!drag) clear();
      },
      { signal },
    );
    rail.addEventListener(
      'pointerleave',
      () => {
        if (!drag) clear();
      },
      { signal },
    );
    function finish(cancel = false) {
      if (!drag) return;
      const { from, handle, id, moved } = drag;
      drag = null;
      cancelAnimationFrame(frame);
      clear();
      rail.classList.remove('is-dragging');
      if (handle.hasPointerCapture(id)) handle.releasePointerCapture(id);
      if (moved && !cancel) commands.move(from, insertion);
      else if (cancel) announce('슬라이드 이동을 취소했습니다.');
    }
    rail.addEventListener(
      'pointerdown',
      (event) => {
        const handle = event.target.closest('[data-slide-drag]');
        if (!handle || event.button !== 0 || drag) return;
        event.preventDefault();
        handle.setPointerCapture(event.pointerId);
        drag = {
          handle,
          id: event.pointerId,
          from: Number(handle.dataset.slideDrag),
          x: event.clientX,
          y: event.clientY,
          startX: event.clientX,
          startY: event.clientY,
          moved: false,
        };
        let lastFrame = 0;
        const tick = (time) => {
          const elapsed = Math.min(32, time - lastFrame || 16);
          lastFrame = time;
          if (!drag) return;
          const r = rail.getBoundingClientRect(),
            h = horizontal(),
            point = h ? drag.x : drag.y,
            start = h ? r.left : r.top,
            end = h ? r.right : r.bottom;
          const speed = ((point < start + 32 ? -10 : point > end - 32 ? 10 : 0) * elapsed) / 16;
          if (speed) rail.scrollBy({ left: h ? speed : 0, top: h ? 0 : speed });
          if (drag.moved) spot({ clientX: drag.x, clientY: drag.y });
          frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      },
      { signal },
    );
    document.addEventListener(
      'pointermove',
      (event) => {
        if (!drag || event.pointerId !== drag.id) return;
        drag.x = event.clientX;
        drag.y = event.clientY;
        if (Math.hypot(drag.x - drag.startX, drag.y - drag.startY) > 5) {
          drag.moved = true;
          rail.classList.add('is-dragging');
          spot(event);
        }
      },
      { signal },
    );
    document.addEventListener(
      'pointerup',
      (event) => {
        if (drag?.id === event.pointerId) finish();
      },
      { signal },
    );
    document.addEventListener('pointercancel', () => finish(true), { signal });
    document.addEventListener(
      'keydown',
      (event) => {
        const opened = native ? menu.matches(':popover-open') : !menu.hidden;
        if (
          opened &&
          !menu.contains(document.activeElement) &&
          ['ArrowDown', 'ArrowUp', 'Escape'].includes(event.key)
        ) {
          event.preventDefault();
          if (event.key === 'Escape') close();
          else {
            const buttons = [...menu.querySelectorAll('button:not(:disabled)')];
            buttons[event.key === 'ArrowDown' ? 0 : buttons.length - 1]?.focus();
          }
        }
        if (event.key === 'Escape' && drag) {
          event.preventDefault();
          finish(true);
        }
      },
      { signal },
    );
    rail.addEventListener(
      'lostpointercapture',
      () => {
        if (drag) finish(true);
      },
      { signal },
    );
    release = () => {
      finish(true);
      events.abort();
      menu.remove();
    };
  }
  return { enhance, dispose: () => release() };
};
