// Purpose: Own editor tab interaction and transient search match highlighting.
// Pattern: Rerender-scoped DOM enhancement with feature-detected native APIs.
// Usage: Called after render; dispose releases listeners and highlight ranges.
// Related: mock/app.js, mock/js/asset-search.js, mock/styles/search-editor.css.
window.PreMModules.editorSupport = ({
  ui,
  fitSlides,
  revealActiveStrips,
  deck,
  commands,
  selection,
  chat,
  icon,
  announce,
}) => {
  const list = window.PreMModules.slideList({ ui, deck, commands, icon, announce });
  const canvas = window.PreMModules.canvasEditor({ ui, deck, commands, announce, selection });
  let events;
  const name = 'prem-search';
  function dispose() {
    events?.abort();
    list.dispose();
    canvas.dispose();
    chat.dispose();
    globalThis.CSS?.highlights?.delete(name);
  }
  function enhance() {
    dispose();
    events = new AbortController();
    list.enhance();
    canvas.enhance();
    chat.enhance();
    for (const button of document.querySelectorAll('[data-editor-panel]')) {
      button.addEventListener(
        'click',
        () => {
          const slides = button.dataset.editorPanel === 'slides';
          const key = slides ? 'collapsedSlides' : 'collapsedInspector';
          const panel = document.getElementById(button.getAttribute('aria-controls'));
          ui[key] = !ui[key];
          panel.hidden = ui[key];
          button.setAttribute('aria-expanded', String(!ui[key]));
          button.querySelector('.sr-only').textContent =
            (slides ? '슬라이드 목록 ' : 'AI 대화 / 참고 자료 ') + (ui[key] ? '펼치기' : '접기');
          button.setAttribute('aria-label', button.querySelector('.sr-only').textContent);
          button.title = button.querySelector('.sr-only').textContent;
          document.querySelector('.editor-grid').dataset[
            slides ? 'slidesCollapsed' : 'inspectorCollapsed'
          ] = String(ui[key]);
          fitSlides();
          revealActiveStrips();
        },
        { signal: events.signal },
      );
    }
    const tabs = [...document.querySelectorAll('[data-editor-tab]')];
    function select(tab) {
      ui.editorTab = tab.dataset.editorTab;
      for (const item of tabs) {
        const chosen = item === tab;
        item.setAttribute('aria-selected', String(chosen));
        item.tabIndex = chosen ? 0 : -1;
        item.toggleAttribute('focusgroupstart', chosen);
        document.querySelector('#editor-' + item.dataset.editorTab + '-panel').hidden = !chosen;
      }
      fitSlides();
    }
    for (const tab of tabs) {
      tab.addEventListener('click', () => select(tab), { signal: events.signal });
      tab.addEventListener('focus', () => select(tab), { signal: events.signal });
      tab.addEventListener(
        'keydown',
        (event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const index =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? tabs.length - 1
                : (tabs.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) %
                  tabs.length;
          tabs[index].focus();
        },
        { signal: events.signal },
      );
    }
    const query = (ui.search.references ?? '').trim().toLowerCase();
    if (!query || ui.view !== 'references') return;
    const ranges = [];
    for (const root of document.querySelectorAll('[data-search-match]')) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        let from = node.textContent.toLowerCase().indexOf(query);
        while (from !== -1) {
          const range = document.createRange();
          range.setStart(node, from);
          range.setEnd(node, from + query.length);
          ranges.push(range);
          from = node.textContent.toLowerCase().indexOf(query, from + query.length);
        }
      }
    }
    if (globalThis.CSS?.highlights && globalThis.Highlight)
      CSS.highlights.set(name, new Highlight(...ranges));
    else
      for (const range of ranges.reverse()) {
        const mark = document.createElement('mark');
        mark.className = 'search-match';
        range.surroundContents(mark);
      }
  }
  return { enhance, dispose };
};
