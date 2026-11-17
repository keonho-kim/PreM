// Purpose: Render project navigation, overview, and project collections.
// Pattern: Feature factory with an explicit application context.
// Usage: Registered before mock/app.js by mock/index.html.
// Related: mock/app.js, mock/index.html.
window.PreMModules.projects = (context) => {
  'use strict';
  const {
    esc,
    icon,
    badge,
    bytes,
    ui,
    project,
    guide,
    href,
    docStatus,
    selectedTemplate,
    pageHeading,
    empty,
    renderSlide,
    activityList,
  } = context;
  const gallery = window.PreMModules.projectGallery({
    readProjects: () => context.store.projects,
    ui,
    esc,
    icon,
    renderSlide,
    render: context.render,
    announce: context.announce,
  });
  const menu = window.PreMModules.projectMenu({
    icon,
    esc,
    readProjects: () => context.store.projects,
  });
  const management = window.PreMModules.projectManagement({
    readProjects: () => context.store.projects,
    readRuns: () => context.store.runs,
    readSelectedId: () => ui.projectId,
    selectProject: (p) => {
      ui.projectId = p?.id ?? '';
      ui.docId = p?.documents[0]?.id ?? '';
      ui.deckId = p?.decks[0]?.id ?? '';
      ui.outlineId = p?.outlines[0]?.id ?? '';
      ui.slideIndex = 0;
      ui.page = 1;
    },
    cancelGeneration: () => {
      clearInterval(context.generationTimer);
      context.generationTimer = null;
    },
    esc,
    uid: context.uid,
    openDialog: context.openDialog,
    closeDialog: context.closeDialog,
    render: context.render,
    announce: context.announce,
  });
  function viewOverview() {
    const p = project(),
      latest = p.decks[0];
    const rows = [
      [
        'documents',
        '원본 문서',
        'Files',
        `${p.documents.length}개 파일에서 내용을 준비합니다.`,
        p.documents.length ? '등록됨' : '문서 필요',
      ],
      ['guide', '작성 방향', 'BookOpen', `PPT에 담을 내용과 표현을 정합니다.`, '저장됨'],
      [
        'outline',
        '목차 정리',
        'ListTree',
        `${p.outlines.length}개 목차와 원문 근거를 검토합니다.`,
        '검토 가능',
      ],
      [
        'references',
        '참고 자료',
        'Library',
        `${p.selectedRefs.length}개 공용 자료를 선택했습니다.`,
        '선택됨',
      ],
      ['templates', '디자인 템플릿', 'PanelsTopLeft', selectedTemplate().name, '선택됨'],
    ];
    return (
      pageHeading(
        p.name,
        '자료를 확인하고 만들던 PPT를 이어서 작업하세요.',
        `<button type="button" class="button" data-action="upload">${icon('Plus')}문서 추가</button><button type="button" class="button primary" data-action="generate">${icon('Presentation')}PPT 만들기</button>`,
      ) +
      `<dl class="meta-strip"><div><dt>원본 문서</dt><dd>${p.documents.length}개</dd></div><div><dt>참고 자료</dt><dd>${p.selectedRefs.length}개</dd></div><div><dt>내용 목차</dt><dd>${p.outlines.length}개</dd></div><div><dt>프레젠테이션</dt><dd>${p.decks.length}개</dd></div></dl>` +
      `<div class="overview-main"><section class="panel presentation-focus"><div class="section-title"><h2>최근 프레젠테이션</h2><a href="${href('presentations')}">전체 보기</a></div>${latest ? `<div class="preview-well">${renderSlide(latest.slides[0], 0, latest.template)}</div><div class="preview-caption"><div><strong>${esc(latest.title)}</strong><p>${latest.slides.length}장 · 이어서 편집할 수 있습니다</p></div><a class="button quiet-button" href="${href('editor', { deck: latest.id })}">편집 이어가기${icon('ChevronRight')}</a></div>` : empty('첫 프레젠테이션을 구성하세요', '원본과 목차를 준비한 뒤 PPT 만들기를 선택하세요.')}</section><section class="panel preparation-ledger"><div class="section-title"><h2>이어서 작업하기</h2>${badge('공유 프로젝트')}</div><ul class="task-list">${rows.map(([view, title, name, caption, status]) => `<li><a href="${href(view)}">${icon(name)}<span><strong>${title}</strong><span class="task-caption">${esc(caption)}</span></span>${badge(status, view === 'outline' ? 'wait' : 'good')}</a></li>`).join('')}</ul><div class="notice task-notice">${icon('CircleAlert')}<p>작성 방향을 바꿔도 이미 만든 PPT는 그대로입니다.</p></div></section></div>` +
      `<div class="overview-bottom"><section class="panel"><div class="section-title"><h2>프로젝트 원본</h2><a href="${href('documents')}">문서 보기</a></div>${p.documents.length ? `<ul class="file-list">${p.documents.map((doc) => `<li><div class="file-info">${icon('FileText')}<span><strong>${esc(doc.name)}</strong><small>${bytes(doc.size)} / ${doc.sample ? '샘플 문서' : '목업 등록'}</small></span></div>${docStatus(doc.status)}</li>`).join('')}</ul>` : '<p class="quiet">아직 등록한 원본 문서가 없습니다.</p>'}</section><section class="panel"><div class="section-title"><h2>최근 작업</h2><a href="${href('history')}">이력 보기</a></div>${activityList(p.history.slice(0, 3))}</section></div>`
    );
  }

  function viewProjects() {
    return (
      pageHeading(
        '프로젝트',
        '프로젝트를 열어 Studio에서 발표 자료를 만드세요.',
        `<button type="button" id="project-create-button" class="button primary" data-action="new-project">${icon('Plus')}프로젝트 만들기</button>`,
      ) +
      `<nav class="project-tabs" aria-label="프로젝트 상태">${[
        ['active', '진행 중'],
        ['archived', '보관됨'],
        ['all', '전체'],
      ]
        .map(
          ([value, label]) =>
            `<button type="button" class="button" data-action="filter-projects" data-value="${value}" aria-pressed="${(ui.projectFilter ?? 'active') === value}">${label}<span class="num">${context.store.projects.filter((item) => value === 'all' || item.status === value).length}</span></button>`,
        )
        .join('')}</nav>` +
      gallery.filters() +
      gallery.content()
    );
  }
  return {
    viewOverview,
    viewProjects,
    enhanceProjectWorkspace: () => {
      menu.enhance();
      gallery.enhance();
    },
    disposeProjectWorkspace: () => {
      menu.dispose();
      gallery.dispose();
    },
    projectHandlers: { ...management.handlers, ...gallery.handlers },
    submitProjectFilter: gallery.submit,
    submitProjectRename: management.submit,
  };
};
