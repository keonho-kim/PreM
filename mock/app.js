// Purpose: Wire the mock state, feature modules, routing, and browser lifecycle.
// Pattern: Composition root with one owned mutable application context.
// Usage: Loaded last by mock/index.html to compose the feature factories.
// Related: mock/app.js, mock/index.html.
(() => {
  'use strict';
  const modules = window.PuPuTyXModules;
  const dom = modules.dom({});
  const { $, $$, esc, clone, uid, icon, badge } = dom;
  const data = modules.data(dom);
  const { navigation, templateLibrary, seed } = data;
  const ui = {
    view: 'projects',
    projectId: 'platform',
    docId: 'doc1',
    page: 1,
    outlineId: 'o1',
    referenceId: 'r1',
    deckId: 'deck1',
    slideIndex: 0,
    adminTab: 'providers',
    spaceTab: 'references',
    search: {},
    lastUndo: null,
  };

  const workspace = $('#workspace');

  const dialog = $('#app-dialog');

  const project = () =>
    context.store.projects.find((item) => item.id === ui.projectId) ?? context.store.projects[0];

  const guide = () => project().guides.at(-1);

  const deck = () => project().decks.find((item) => item.id === ui.deckId) ?? project().decks[0];

  const href = (view, extra = {}) =>
    '#' + new URLSearchParams({ view, project: ui.projectId, ...extra });

  const feedback = modules.feedback({
    $,
    esc,
    icon,
    readAssets: () => context.store.spaceAssets,
    readRuns: () => context.store.runs,
  });
  const announce = feedback.notify;

  const log = (title, description = '', status = 'completed') =>
    project().history.unshift({
      id: uid(),
      title,
      description,
      status,
      at: new Date().toISOString(),
    });

  const docStatus = (status) =>
    status === 'completed'
      ? badge('샘플 분석 완료', 'good')
      : status === 'failed'
        ? badge('추출 오류 예시', 'wait')
        : badge('등록됨');

  const selectedTemplate = () =>
    templateLibrary.find((item) => item.id === project().template) ?? templateLibrary[0];

  function route(view, extra = {}) {
    const next = new URLSearchParams({ view, project: ui.projectId, ...extra }).toString();
    if (location.hash.slice(1) === next) {
      ui.view = view;
      render();
    } else location.hash = next;
  }

  function parseRoute(event) {
    const params = new URLSearchParams(location.hash.slice(1));
    ui.view = params.get('view') ?? 'projects';
    if (context.store.projects.some((item) => item.id === params.get('project')))
      ui.projectId = params.get('project');
    if (params.has('deck')) {
      if (ui.deckId !== params.get('deck')) ui.slideIndex = 0;
      ui.deckId = params.get('deck');
    }
    ui.adminTab = params.get('tab') ?? 'providers';
    ui.spaceTab = params.get('tab') === 'templates' ? 'templates' : 'references';
    if (ui.view === 'home') ui.view = 'projects';
    if (ui.view === 'studio') ui.view = 'documents';
    if (ui.view === 'admin' && ['references', 'templates'].includes(ui.adminTab)) {
      ui.spaceTab = ui.adminTab;
      ui.view = 'space';
    }
    if (ui.view === 'admin' && context.store.session.role !== 'admin') ui.view = 'projects';
    if (
      !['projects', 'space', 'admin', 'editor', ...navigation.map(([id]) => id)].includes(ui.view)
    )
      ui.view = 'overview';
    if (!project()) ui.view = ['space', 'admin'].includes(ui.view) ? ui.view : 'projects';
    if (ui.view === 'editor' && !project().decks.length) ui.view = 'presentations';
    if (dialog.open) dialog.close();
    render();
    if (event?.type === 'hashchange') {
      window.scrollTo(0, 0);
      requestAnimationFrame(() => $('#main-title')?.focus({ preventScroll: true }));
    }
  }

  function render() {
    chrome.renderNavigation();
    context.disposeDocumentGallery();
    context.disposeProjectWorkspace();
    const views = {
      projects: context.viewProjects,
      overview: context.viewOverview,
      documents: context.viewDocuments,
      guide: context.viewGuide,
      outline: context.viewOutline,
      references: context.viewReferences,
      templates: context.viewTemplates,
      presentations: context.viewPresentations,
      editor: context.viewEditor,
      history: context.viewHistory,
      admin: context.viewAdmin,
      space: space.view,
    };
    workspace.dataset.view = ui.view;
    workspace.innerHTML =
      studio.contextBar() + studio.stepper() + views[ui.view]() + studio.footer();
    chrome.syncLayout();
    context.enhanceDocumentGallery();
    context.enhanceTables();
    space.updateIndicators();
    document.title = ($('#main-title')?.textContent ?? 'PuPuTyX') + ' | PuPuTyX 목업';
    context.fitSlides();
    editorSupport.enhance();
    context.enhanceProjectWorkspace();
  }

  function openDialog(title, content, wide = false) {
    dialog.classList.toggle('wide-dialog', wide);
    $('#dialog-content').innerHTML =
      `<div class="dialog-heading"><h2 id="dialog-title">${esc(title)}</h2><button type="button" class="icon-button" data-action="close-dialog" aria-label="대화 상자 닫기">${icon('X')}</button></div>${content}`;
    if (!dialog.open) dialog.showModal();
    context.fitSlides();
  }

  function closeDialog() {
    dialog.close();
  }

  const cancelButton =
    '<button class="button" type="button" data-action="close-dialog">취소</button>';

  function commitSlides(slides, title) {
    slideCommands.commit(slides, title);
  }

  const { validateFiles, metadata } = modules.uploads({ $, uid });

  function changeOutline(operation) {
    const p = project();
    p.outlineHistory ??= [];
    p.outlineHistory.push({ version: p.outlineVersion, nodes: clone(p.outlines) });
    operation(p);
    p.outlineVersion += 1;
    log('목차 리비전 v' + p.outlineVersion + ' 저장', '기존 프레젠테이션은 유지');
  }

  function moveOutline(direction) {
    const p = project(),
      index = p.outlines.findIndex((node) => node.id === ui.outlineId),
      next = index + direction;
    if (next < 0 || next >= p.outlines.length) {
      announce('이 방향으로 더 이동할 수 없습니다.');
      return;
    }
    changeOutline((item) => {
      const [node] = item.outlines.splice(index, 1);
      item.outlines.splice(next, 0, node);
    });
    render();
  }
  const context = {
    ...dom,
    ...data,
    store: seed(),
    generationTimer: null,
    ui,
    workspace,
    dialog,
    project,
    guide,
    deck,
    href,
    announce,
    log,
    docStatus,
    selectedTemplate,
    route,
    parseRoute,
    render,
    openDialog,
    closeDialog,
    cancelButton,
    commitSlides,
    validateFiles,
    metadata,
    refreshFeedback: feedback.renderTasks,
    changeOutline,
    moveOutline,
  };
  const chrome = modules.chrome({
    $,
    $$,
    esc,
    icon,
    href,
    revealActiveStrips: dom.revealActiveStrips,
    readState: () => ({
      view: ui.view,
      role: context.store.session.role,
    }),
  });
  const studio = modules.studio({
    $,
    readProject: project,
    readView: () => ui.view,
    readRuns: () => context.store.runs,
    esc,
    icon,
    href,
    route,
    announce,
  });
  const selection = modules.editorSelection({ ui, deck });
  const slideCommands = modules.slideCommands({
    deck,
    ui,
    clone,
    uid,
    log,
    render,
    announce,
    readDraft: dom.readCanvasDraft,
    selectObject: (id) => selection.choose(id ? 'object:' + id : null),
  });
  context.slideCommands = slideCommands;
  const chat = modules.editorChat({
    ui,
    deck,
    selection,
    commands: slideCommands,
    esc,
    icon,
    announce,
  });
  context.chat = chat;
  Object.assign(context, modules.ui(context));
  const editorSupport = modules.editorSupport({
    ui,
    fitSlides: context.fitSlides,
    revealActiveStrips: dom.revealActiveStrips,
    deck,
    commands: slideCommands,
    selection,
    chat,
    icon,
    announce,
  });
  Object.assign(context, modules.dialogs(context));
  const disposeDialog = context.bindDialogLifecycle(dialog);
  Object.assign(context, modules.workflow(context));
  Object.assign(context, modules.presentations(context));
  Object.assign(context, modules.projects(context));
  Object.assign(context, modules.documents(context));
  Object.assign(context, modules.content(context));
  Object.assign(context, modules.admin(context));
  const space = modules.space({
    renderSlide: context.renderSlide,
    fitSlides: context.fitSlides,
    ...dom,
    refreshFeedback: feedback.renderTasks,
    readAssets: () => context.store.spaceAssets,
    readTab: () => ui.spaceTab,
    href,
    route,
    render,
    announce,
    openDialog,
    closeDialog,
    validateFiles,
    metadata,
    pageHeading: context.pageHeading,
    templateLibrary,
    referenceLibrary: data.referenceLibrary,
  });
  const actions = {
    ...space.handlers,
    ...context.assetHandlers,
    ...context.projectHandlers,
    'confirm-studio-step': studio.confirm,
    'account-preview': () =>
      openDialog(
        '샘플 화면 설정',
        '<p class="dialog-intro">샘플 화면에서 살펴볼 메뉴를 선택하세요.</p><div class="actions"><button type="button" class="button" data-action="preview-role" data-role="member">일반 화면</button><button type="button" class="button" data-action="preview-role" data-role="admin">관리 화면 포함</button></div>',
      ),
    'preview-role': (target) => {
      context.store.session.role = target.dataset.role === 'admin' ? 'admin' : 'member';
      closeDialog();
      if (ui.view === 'admin' && context.store.session.role !== 'admin') route('projects');
      else render();
    },
    'skip-main': chrome.focusMain,
    ...modules['actions-project'](context).handlers,
    ...modules['actions-presentation'](context).handlers,
  };
  const { submitForm } = modules.forms(context);
  modules.appEvents({
    actions,
    submitSpace: space.submit,
    submitForm,
    chooseAsset: context.chooseAsset,
    parseRoute,
    beforeReset: () => {
      space.dispose();
      feedback.reset();
    },
    afterAction: feedback.renderTasks,
    dispose: () => {
      clearInterval(context.generationTimer);
      context.disposeSlides();
      context.disposeDocumentGallery();
      chrome.dispose();
      space.dispose();
      editorSupport.dispose();
      context.disposeProjectWorkspace();
      disposeDialog();
      feedback.dispose();
    },
  });

  window.PuPuTyXMock = Object.freeze({ snapshot: () => clone(context.store) });

  parseRoute();
})();
