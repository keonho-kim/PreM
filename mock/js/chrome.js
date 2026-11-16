// Purpose: Present Home, Studio, Space, and role-dependent Admin navigation.
// Pattern: One semantic link tree driven by a narrow session read model.
// Usage: Owned by app.js; demo roles never represent server authorization.
// Related: mock/index.html, mock/js/studio.js, mock/styles/workspace-flow.css.
window.PuPuTyXModules.chrome = (capabilities) => {
  'use strict';
  const { $, $$, icon, href, readState, revealActiveStrips } = capabilities;
  const header = $('.app-header');
  let disposed = false;
  const syncHeight = () => {
    document.documentElement.style.setProperty(
      '--app-header-height',
      header.getBoundingClientRect().height + 'px',
    );
    document.documentElement.style.setProperty(
      '--studio-progress-height',
      ($('.studio-progress')?.getBoundingClientRect().height ?? 0) + 'px',
    );
    revealActiveStrips();
  };
  const observer = 'ResizeObserver' in window ? new ResizeObserver(syncHeight) : null;
  observer?.observe(header);
  window.addEventListener('resize', syncHeight);
  document.fonts?.ready.then(() => {
    if (!disposed) syncHeight();
  });
  function renderNavigation() {
    const state = readState();
    const area =
      state.view === 'projects'
        ? 'home'
        : state.view === 'space'
          ? 'space'
          : state.view === 'admin'
            ? 'admin'
            : 'studio';
    const links = [
      ['projects', 'Home', 'home'],
      ['documents', 'Studio', 'studio'],
      ['space', 'Space', 'space'],
    ];
    if (state.role === 'admin') links.push(['admin', 'Admin', 'admin']);
    $('#global-navigation').innerHTML = links
      .map(
        ([view, label, key]) =>
          `<a class="global-link ${key === 'home' ? 'all-projects' : key === 'admin' ? 'admin-link' : ''}" href="${href(view)}" ${area === key ? 'aria-current="page"' : ''}>${label}</a>`,
      )
      .join('');
    $('#account-preview').textContent = '샘플 체험';
    $$('[data-icon]').forEach((node) => {
      node.innerHTML = icon(node.dataset.icon);
    });
    syncHeight();
  }
  return {
    renderNavigation,
    syncLayout: syncHeight,
    focusMain: () => {
      const title = $('#main-title');
      title?.focus({ preventScroll: true });
      title?.scrollIntoView({ block: 'start', behavior: 'auto' });
    },
    dispose: () => {
      disposed = true;
      observer?.disconnect();
      window.removeEventListener('resize', syncHeight);
    },
  };
};
