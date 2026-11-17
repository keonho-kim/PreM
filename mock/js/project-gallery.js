// Purpose: Render a three-column project gallery with end-date filters and pagination.
// Pattern: Feature read model with separate filter/page commands and owned deadline refresh.
// Usage: Composed by views/projects.js; project commands remain with their existing owners.
// Related: project-dates.js, project-menu.js, styles/project-gallery.css.
window.PreMModules.projectGallery = ({
  readProjects,
  ui,
  esc,
  icon,
  renderSlide,
  render,
  announce,
}) => {
  const dates = window.PreMModules.projectDates,
    size = 6;
  let release = () => {};
  const updated = (p) => p.history[0]?.at ?? p.guides.at(-1)?.at;
  function model() {
    const query = (ui.search.projects ?? '').toLowerCase(),
      filter = ui.projectFilter ?? 'active';
    const items = readProjects().filter(
      (p) =>
        p.name.toLowerCase().includes(query) &&
        (filter === 'all' || p.status === filter) &&
        (!ui.projectDateFrom || (dates.valid(p.endDate) && p.endDate >= ui.projectDateFrom)) &&
        (!ui.projectDateTo || (dates.valid(p.endDate) && p.endDate <= ui.projectDateTo)),
    );
    items.sort((a, b) =>
      ui.projectSort === 'name'
        ? a.name.localeCompare(b.name, 'ko')
        : ui.projectSort === 'deadline'
          ? (a.endDate ?? '9999-12-31').localeCompare(b.endDate ?? '9999-12-31')
          : new Date(updated(b)) - new Date(updated(a)),
    );
    const pages = Math.max(1, Math.ceil(items.length / size));
    const page = Math.max(1, Math.min(pages, ui.projectPage ?? 1));
    return { items, pages, page, visible: items.slice((page - 1) * size, page * size) };
  }
  function filters() {
    return `<form class="project-gallery-filters" data-form="project-filter" method="get" action="#" aria-label="프로젝트 검색 조건"><div class="field"><label for="search-input">프로젝트 이름</label><input type="search" id="search-input" name="q" value="${esc(ui.search.projects ?? '')}" placeholder="프로젝트 이름 검색" /></div><fieldset><legend>마감일 범위</legend><div class="project-date-range"><div class="field"><label class="sr-only" for="project-date-from">이 날짜 이후 마감</label><input id="project-date-from" name="from" type="date" min="1900-01-01" max="9999-12-31" value="${esc(ui.projectDateFrom ?? '')}" /></div><span aria-hidden="true">–</span><div class="field"><label class="sr-only" for="project-date-to">이 날짜 이전 마감</label><input id="project-date-to" name="to" type="date" min="1900-01-01" max="9999-12-31" value="${esc(ui.projectDateTo ?? '')}" /></div></div></fieldset><div class="field"><label for="project-sort">정렬</label><select id="project-sort" name="sort"><option value="recent" ${!ui.projectSort || ui.projectSort === 'recent' ? 'selected' : ''}>최근 수정순</option><option value="name" ${ui.projectSort === 'name' ? 'selected' : ''}>이름순</option><option value="deadline" ${ui.projectSort === 'deadline' ? 'selected' : ''}>마감일 가까운 순</option></select></div><div class="actions"><button type="submit" class="button">${icon('Search')}검색</button><button type="button" class="button quiet-button" data-action="project-filter-clear">초기화</button></div></form>`;
  }
  function card(p) {
    const deck = p.decks[0],
      due = dates.deadline(p.endDate),
      when = updated(p);
    return `<article class="project-gallery-card" data-project-row="${esc(p.id)}"><div class="project-card-preview" aria-hidden="true">${deck ? renderSlide(deck.slides[0], 0, deck.template) : `<div class="project-no-preview">${icon('Files')}<span>아직 생성된 PPT가 없습니다</span></div>`}</div><header><div class="project-card-status"><span>${p.status === 'archived' ? '보관됨' : '진행 중'}</span><span class="project-d-day" data-project-deadline="${esc(p.endDate ?? '')}" data-state="${due.state}" title="${due.label}">${due.text}</span></div><h2><a class="project-card-link" href="#${new URLSearchParams({ view: 'overview', project: p.id })}">${esc(p.name)}</a></h2></header><dl class="project-card-facts"><div><dt>문서</dt><dd>${p.documents.length}개</dd></div><div><dt>PPT</dt><dd>${p.decks.length}개</dd></div><div><dt>작성 방향</dt><dd>${p.guides.length ? '저장됨' : '미작성'}</dd></div><div class="project-card-end"><dt>마감일</dt><dd>${dates.valid(p.endDate) ? `<time datetime="${p.endDate}">${dates.label(p.endDate)}</time>` : '미정'}</dd></div></dl><footer><span>최근 수정 <time datetime="${esc(when)}">${new Date(when).toLocaleDateString('ko-KR')}</time></span><button type="button" class="icon-button" data-project-menu-trigger="${esc(p.id)}" aria-haspopup="menu" aria-expanded="false" aria-label="${esc(p.name)} 프로젝트 작업" title="프로젝트 작업">${icon('Ellipsis')}</button></footer></article>`;
  }
  function content() {
    const { items, pages, page, visible } = model();
    if (!items.length)
      return `<div class="empty-state"><h2>${readProjects().length ? '조건에 맞는 프로젝트가 없습니다' : '첫 프로젝트를 만들어 보세요'}</h2><p>${readProjects().length ? '이름이나 마감일 범위을 바꿔 검색하세요.' : '프로젝트 이름과 종료일을 입력해 시작하세요.'}</p></div>`;
    const nearby = [...new Set([1, page - 1, page, page + 1, pages])]
      .filter((n) => n >= 1 && n <= pages)
      .sort((a, b) => a - b);
    return `<div class="project-gallery-summary"><p id="project-gallery-heading" tabindex="-1">${items.length}개 프로젝트 · ${(page - 1) * size + 1}–${Math.min(page * size, items.length)} 표시</p><span>페이지당 6개</span></div><div class="project-gallery" aria-labelledby="project-gallery-heading">${visible.map(card).join('')}</div><nav class="project-pagination" aria-label="프로젝트 페이지"><button class="button quiet-button" type="button" data-action="project-page" data-page="${page - 1}" ${page === 1 ? 'disabled' : ''}>${icon('ChevronLeft')}이전</button><div>${nearby.map((n, i) => `${i && n - nearby[i - 1] > 1 ? '<span aria-hidden="true">…</span>' : ''}<button class="button" type="button" data-action="project-page" data-page="${n}" ${n === page ? 'aria-current="page"' : ''} aria-label="${n}페이지">${n}</button>`).join('')}</div><button class="button quiet-button" type="button" data-action="project-page" data-page="${page + 1}" ${page === pages ? 'disabled' : ''}>다음${icon('ChevronRight')}</button></nav>`;
  }
  function submit(form) {
    const values = new FormData(form),
      from = String(values.get('from') ?? ''),
      to = String(values.get('to') ?? '');
    if ((from && !dates.valid(from)) || (to && !dates.valid(to)) || (from && to && from > to)) {
      const input = form.elements.namedItem('to');
      input.setCustomValidity('마감일 범위의 시작과 끝을 확인해 주세요.');
      input.reportValidity();
      return;
    }
    ui.search.projects = String(values.get('q') ?? '').trim();
    ui.projectDateFrom = from;
    ui.projectDateTo = to;
    ui.projectSort = ['recent', 'name', 'deadline'].includes(values.get('sort'))
      ? values.get('sort')
      : 'recent';
    ui.projectPage = 1;
    render();
    document.getElementById('search-input')?.focus();
  }
  function enhance() {
    release();
    const filterForm = document.querySelector('[data-form="project-filter"]');
    if (!filterForm) return;
    const events = new AbortController();
    let timer;
    function refresh() {
      for (const node of document.querySelectorAll('[data-project-deadline]')) {
        const due = dates.deadline(node.dataset.projectDeadline);
        node.textContent = due.text;
        node.dataset.state = due.state;
        node.title = due.label;
      }
      clearTimeout(timer);
      const now = new Date(),
        next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      timer = setTimeout(refresh, next.getTime() - now.getTime() + 50);
    }
    document.addEventListener(
      'visibilitychange',
      () => {
        if (!document.hidden) refresh();
      },
      { signal: events.signal },
    );
    filterForm.addEventListener(
      'input',
      () => {
        filterForm.elements.namedItem('from').setCustomValidity('');
        filterForm.elements.namedItem('to').setCustomValidity('');
      },
      { signal: events.signal },
    );
    refresh();
    release = () => {
      clearTimeout(timer);
      events.abort();
    };
  }
  return {
    filters,
    content,
    submit,
    enhance,
    dispose: () => release(),
    handlers: {
      'project-page': (target) => {
        const next = Number(target.dataset.page);
        if (!Number.isInteger(next) || next < 1 || next > model().pages) return;
        ui.projectPage = next;
        render();
        document.getElementById('project-gallery-heading')?.focus();
        announce(`${next}페이지를 표시했습니다.`);
      },
      'project-filter-clear': () => {
        ui.search.projects = '';
        ui.projectDateFrom = '';
        ui.projectDateTo = '';
        ui.projectPage = 1;
        render();
        document.getElementById('search-input')?.focus();
      },
    },
  };
};
