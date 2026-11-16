// Purpose: Own project overflow and context menus with keyboard and native popover behavior.
// Pattern: Rerender-scoped DOM adapter; commands bubble to the existing action dispatcher.
// Usage: Enhanced by the projects view after rendering, disposed on rerender and page exit.
// Related: views/projects.js, project-management.js, styles/project-menu.css.
window.PuPuTyXModules.projectMenu = ({ icon, esc, readProjects }) => {
  let release = () => {};
  function enhance() {
    release();
    const workspace = document.querySelector('#workspace[data-view="projects"]');
    if (!workspace) return;
    const events = new AbortController(),
      signal = events.signal;
    const popover = 'showPopover' in HTMLElement.prototype;
    const commands = popover && 'commandForElement' in HTMLButtonElement.prototype;
    const anchored =
      popover && CSS.supports('position-area: block-end') && 'source' in ToggleEvent.prototype;
    const focusgroup = 'focusGroup' in HTMLElement.prototype;
    const menus = [];
    const listen = (node, event, fn, extra = {}) =>
      node.addEventListener(event, fn, { ...extra, signal });
    for (const row of [...workspace.querySelectorAll('[data-project-row]'), workspace]) {
      const id = row.dataset.projectRow,
        background = row === workspace;
      const trigger = background
        ? document.getElementById('project-create-button')
        : row.querySelector('[data-project-menu-trigger]');
      const project = background ? null : readProjects().find((item) => item.id === id);
      if (!trigger || (!background && !project)) continue;
      let origin = trigger;
      const menu = document.createElement('div'),
        point = document.createElement('span');
      menu.id = background ? 'project-background-menu' : `project-menu-${id}`;
      menu.className = 'project-context-menu';
      if (popover) menu.setAttribute('popover', 'auto');
      else menu.hidden = true;
      if (anchored) menu.dataset.anchored = '';
      point.className = 'project-menu-point';
      point.setAttribute('aria-hidden', 'true');
      trigger.before(point);
      trigger.after(menu);
      if (!background) trigger.setAttribute('aria-controls', menu.id);
      if (commands && !background) {
        trigger.setAttribute('command', 'toggle-popover');
        trigger.setAttribute('commandfor', menu.id);
      }
      const choices = [
        ['new-project', 'Plus', '새 프로젝트'],
        ...(project
          ? [
              ['rename-project', 'Pencil', '이름 바꾸기'],
              ['clone-project', 'Copy', '복제'],
              [
                'archive-project',
                project.status === 'archived' ? 'RotateCcw' : 'Archive',
                project.status === 'archived' ? '복원' : '보관',
              ],
              ['delete-project', 'Trash2', '삭제'],
            ]
          : []),
      ];
      menu.innerHTML = `<div focusgroup="menu nomemory" aria-label="${background ? '프로젝트 목록 작업' : esc(project.name) + ' 프로젝트 작업'}">${choices.map(([action, name, label]) => `${['rename-project', 'delete-project'].includes(action) ? '<hr />' : ''}<button type="button" data-action="${action}" ${project ? `data-id="${esc(id)}"` : ''}>${icon(name)}<span>${label}</span></button>`).join('')}</div>`;
      const group = menu.firstElementChild,
        items = [...group.querySelectorAll('button')];
      if (!focusgroup) {
        group.setAttribute('role', 'menu');
        items.forEach((item) => {
          item.setAttribute('role', 'menuitem');
          item.tabIndex = -1;
        });
      }
      let entered = false,
        pointer = false,
        location = null;
      const isOpen = () => (popover ? menu.matches(':popover-open') : !menu.hidden);
      function position() {
        if (anchored) return;
        const rect = menu.getBoundingClientRect(),
          anchor = trigger.getBoundingClientRect();
        const x = location?.x ?? anchor.right - rect.width;
        let y = location?.y ?? anchor.bottom + 4;
        if (y + rect.height > innerHeight - 8) y = (location?.y ?? anchor.top) - rect.height - 4;
        menu.style.left = `${Math.max(8, Math.min(x, innerWidth - rect.width - 8))}px`;
        menu.style.top = `${Math.max(8, Math.min(y, innerHeight - rect.height - 8))}px`;
      }
      function opened() {
        if (!background) trigger.setAttribute('aria-expanded', String(isOpen()));
        if (!isOpen()) return;
        position();
        (entered ? items[0] : origin).focus({ preventScroll: true });
      }
      function close(restore = true) {
        if (!isOpen()) return;
        if (restore) origin.focus({ preventScroll: true });
        if (popover) menu.hidePopover();
        else {
          menu.hidden = true;
          opened();
        }
      }
      function openAt(event, keyboard = false) {
        event.preventDefault();
        menus.forEach((other) => {
          if (other.menu !== menu) other.close(false);
        });
        origin =
          background && keyboard
            ? (event.target.closest('[tabindex],button,a') ?? trigger)
            : trigger;
        entered = keyboard || background;
        location = keyboard ? null : { x: event.clientX, y: event.clientY };
        point.style.left = `${location?.x ?? 0}px`;
        point.style.top = `${location?.y ?? 0}px`;
        if (isOpen()) close(false);
        origin.focus({ preventScroll: true });
        if (popover) menu.showPopover({ source: location ? point : trigger });
        else {
          menu.hidden = false;
          opened();
        }
      }
      menus.push({ menu, point, close });
      listen(menu, 'toggle', opened);
      if (!background) {
        listen(trigger, 'pointerdown', (event) => {
          if (event.button === 0) {
            pointer = true;
            event.preventDefault();
          }
        });
        listen(trigger, 'click', (event) => {
          entered = !pointer && event.detail === 0;
          pointer = false;
          location = null;
          if (!commands) {
            event.preventDefault();
            if (isOpen()) close();
            else if (popover) menu.showPopover({ source: trigger });
            else {
              menu.hidden = false;
              opened();
            }
          }
        });
        listen(trigger, 'keydown', (event) => {
          pointer = false;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!isOpen()) openAt(event, true);
            (event.key === 'ArrowUp' ? items.at(-1) : items[0]).focus();
          }
        });
      } else listen(trigger, 'click', () => close(false));
      const nativeContext = (event) =>
        background &&
        event.target.closest(
          '[data-project-row],input,textarea,select,button,a,summary,[contenteditable],.project-context-menu',
        );
      listen(row, 'contextmenu', (event) => {
        if (!nativeContext(event)) openAt(event, event.clientX === 0 && event.clientY === 0);
      });
      listen(row, 'keydown', (event) => {
        if (
          !nativeContext(event) &&
          (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))
        )
          openAt(event, true);
      });
      listen(menu, 'pointermove', (event) =>
        event.target.closest('button')?.focus({ preventScroll: true }),
      );
      listen(menu, 'click', (event) => {
        if (event.target.closest('[data-action]')) close();
      });
      listen(group, 'keydown', (event) => {
        if (event.key === 'Escape' || event.key === 'Tab') {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
          }
          close();
          return;
        }
        if (!focusgroup && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          const i = items.indexOf(document.activeElement);
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? items.length - 1
                : (i + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
          items[next].focus();
        }
      });
      listen(document, 'keydown', (event) => {
        if (event.key === 'Escape' && isOpen()) {
          event.preventDefault();
          close();
        }
      });
      listen(document, 'pointerdown', (event) => {
        if (!menu.contains(event.target) && !origin.contains(event.target)) close(false);
      });
      listen(document, 'focusin', (event) => {
        if (!menu.contains(event.target) && !origin.contains(event.target)) close(false);
      });
      listen(window, 'resize', () => {
        if (isOpen()) position();
      });
      listen(
        document,
        'scroll',
        (event) => {
          if (!isOpen() || menu.contains(event.target)) return;
          if (location) close(false);
          else position();
        },
        { capture: true },
      );
    }
    release = () => {
      events.abort();
      for (const item of menus) {
        item.close(false);
        item.menu.remove();
        item.point.remove();
      }
    };
  }
  return { enhance, dispose: () => release() };
};
