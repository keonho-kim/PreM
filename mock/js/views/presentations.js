// Purpose: Render presentation collections, slide editing, and workflow history.
// Pattern: Feature factory with an explicit application context.
// Usage: Registered before mock/app.js by mock/index.html.
// Related: mock/app.js, mock/index.html.
window.PreMModules.presentations = (context) => {
  'use strict';
  const {
    esc,
    icon,
    button,
    badge,
    ui,
    project,
    deck,
    href,
    pageHeading,
    empty,
    renderSlide,
    activityList,
  } = context;
  const tool = (label, name, command, extra = '') =>
    `<button type="button" class="icon-button" data-canvas-command="${command}" aria-label="${label}" title="${label}" ${extra}>${icon(name)}</button>`;
  function workflowPanel() {
    const run = context.store.runs.findLast((item) => item.projectId === project().id);
    if (!run) return '';
    return `<section class="workflow-panel" data-run-panel><div class="run-label"><h2>${esc(run.title)}</h2><span data-run-status>${badge(run.status === 'completed' ? '완료' : run.status === 'cancelled' ? '취소됨' : run.status === 'paused' ? '일시 정지' : '만드는 중', run.status === 'completed' ? 'good' : 'wait')}</span></div><p data-run-description role="status">${esc(context.generationMessage(run))}</p><progress data-run-progress max="6" value="${run.step}" aria-label="PPT 만들기 진행 · 샘플"></progress>${['running', 'paused'].includes(run.status) ? `<div class="actions task-notice"><button class="button" type="button" data-action="toggle-run">${icon(run.status === 'paused' ? 'Play' : 'Pause')}${run.status === 'paused' ? '이어가기' : '일시 정지'}</button>${button('만들기 취소', 'cancel-run', 'X')}</div>` : ''}<p class="quiet small">샘플 작업</p></section>`;
  }

  function viewPresentations() {
    const p = project();
    return (
      pageHeading(
        'PPT 생성과 편집',
        '슬라이드를 구성하고, 수정안을 검토한 뒤 적용하세요.',
        '<button type="button" class="button primary" data-action="generate">' +
          icon('Plus') +
          'PPT 만들기</button>',
      ) +
      (p.decks.length
        ? `<div class="deck-list">${p.decks.map((item) => `<article class="deck-row"><div>${renderSlide(item.slides[0], 0, item.template)}</div><div><h2>${esc(item.title)}</h2><dl class="deck-metadata"><div><dt>슬라이드</dt><dd>${item.slides.length}개</dd></div><div><dt>버전</dt><dd>v${item.version}</dd></div></dl><details class="deck-provenance"><summary>사용한 내용</summary><p>작성 방향 ${item.guideVersion} · 목차 ${item.outlineVersion}</p></details></div><div class="actions"><a class="button" href="${href('editor', { deck: item.id })}">${icon('Presentation')}편집하기</a><button type="button" class="icon-button" data-action="export" data-id="${item.id}" aria-label="${esc(item.title)} 체험 내용 저장">${icon('Download')}</button></div></article>`).join('')}</div>`
        : empty(
            '첫 프레젠테이션을 구성하세요',
            '가이드와 목차를 선택해 샘플 슬라이드를 만듭니다.',
            button('PPT 만들기', 'generate', 'Plus'),
          )) +
      workflowPanel()
    );
  }

  function viewEditor() {
    const d = deck();
    ui.deckId = d.id;
    ui.slideIndex = Math.max(0, Math.min(ui.slideIndex, d.slides.length - 1));
    const slide = d.slides[ui.slideIndex];
    return (
      pageHeading(
        d.title,
        `${d.slides.length}장 · 슬라이드를 선택하고 바로 수정하세요`,
        `<a class="button quiet-button" href="${href('presentations')}">${icon('ArrowLeft')}PPT 목록</a><button type="button" class="button" data-action="export" data-id="${d.id}">${icon('Download')}체험 내용 저장</button>`,
      ) +
      `<div class="editor-toolbar"><div class="actions" aria-label="캔버스 편집 도구">${tool('실행 취소 (⌘/Ctrl+Z)', 'Undo2', 'undo', context.slideCommands.canUndo() ? '' : 'disabled')}${tool('다시 실행 (⌘/Ctrl+Shift+Z)', 'Redo2', 'redo', context.slideCommands.canRedo() ? '' : 'disabled')}<span class="toolbar-divider"></span>${tool('이미지 삽입', 'Image', 'image')}${tool('텍스트 상자 삽입', 'Type', 'text')}${tool('선택 요소 삭제', 'Trash2', 'delete')}<span class="toolbar-divider"></span>${tool('굵게', 'Bold', 'bold')}${tool('기울임', 'Italic', 'italic')}${tool('글자 크게', 'Plus', 'larger')}${tool('글자 작게', 'Minus', 'smaller')}${tool('왼쪽 정렬', 'AlignLeft', 'align-left')}${tool('가운데 정렬', 'AlignCenter', 'align-center')}${tool('오른쪽 정렬', 'AlignRight', 'align-right')}${tool('도형 삽입', 'Square', 'shape')}${tool('맨 앞으로', 'ArrowUp', 'front')}${tool('맨 뒤로', 'ArrowDown', 'back')}<label class="canvas-color" title="글자 색상"><span class="sr-only">글자 색상</span><input type="color" id="canvas-text-color" aria-label="글자 색상" /></label><input id="canvas-image-file" type="file" accept="image/png,image/jpeg,image/webp" hidden /></div>
      <div class="actions">${button('이전 내용 보기', 'deck-revisions', 'History')}<button type="button" class="icon-button" data-action="slide-prev" ${ui.slideIndex === 0 ? 'disabled' : ''} aria-label="이전 슬라이드">${icon('ChevronLeft')}</button><span class="small num">${ui.slideIndex + 1} / ${d.slides.length}</span><button type="button" class="icon-button" data-action="slide-next" ${ui.slideIndex === d.slides.length - 1 ? 'disabled' : ''} aria-label="다음 슬라이드">${icon('ChevronRight')}</button></div></div>
      <div class="editor-panel-controls" aria-label="편집 패널 표시"><button type="button" class="icon-button" data-editor-panel="slides" aria-controls="editor-slides" aria-expanded="${!ui.collapsedSlides}" aria-label="${ui.collapsedSlides ? '슬라이드 목록 펼치기' : '슬라이드 목록 접기'}" title="${ui.collapsedSlides ? '슬라이드 목록 펼치기' : '슬라이드 목록 접기'}">${icon('PanelLeft')}<span class="sr-only">${ui.collapsedSlides ? '슬라이드 목록 펼치기' : '슬라이드 목록 접기'}</span></button><button type="button" class="icon-button" data-editor-panel="inspector" aria-controls="editor-inspector" aria-expanded="${!ui.collapsedInspector}" aria-label="${ui.collapsedInspector ? 'AI 대화 / 참고 자료 펼치기' : 'AI 대화 / 참고 자료 접기'}" title="${ui.collapsedInspector ? 'AI 대화 / 참고 자료 펼치기' : 'AI 대화 / 참고 자료 접기'}">${icon('PanelRight')}<span class="sr-only">${ui.collapsedInspector ? 'AI 대화 / 참고 자료 펼치기' : 'AI 대화 / 참고 자료 접기'}</span></button></div>
      <section class="editor-grid" data-slides-collapsed="${!!ui.collapsedSlides}" data-inspector-collapsed="${!!ui.collapsedInspector}" aria-label="슬라이드 편집 작업 영역">      <aside class="slide-sidebar" id="editor-slides" ${ui.collapsedSlides ? 'hidden' : ''}><div class="rail-heading"><span class="rail-title">슬라이드 ${d.slides.length}</span><button type="button" class="icon-button" data-action="add-slide" title="새 슬라이드" aria-label="새 슬라이드">${icon('Plus')}</button></div><nav data-active-scroll class="slide-rail" aria-label="슬라이드" tabindex="0">${d.slides.map((item, index) => `<div class="slide-list-item" data-slide-index="${index}"><button type="button" class="slide-drag-handle icon-button" data-slide-drag="${index}" aria-label="슬라이드 ${index + 1} 순서 이동" title="드래그 또는 Alt+방향키로 이동">${icon('GripVertical')}</button><button type="button" class="slide-thumb" data-action="select-slide" data-index="${index}" aria-pressed="${index === ui.slideIndex}" aria-label="슬라이드 ${index + 1}: ${esc(item.title)}"><div aria-hidden="true">${renderSlide(item, index, d.template)}</div><span class="slide-caption"><span>${String(index + 1).padStart(2, '0')}</span><span>${esc(item.title.replaceAll('\n', ' '))}</span></span></button><button type="button" class="slide-more icon-button" data-slide-menu="${index}" aria-haspopup="menu" aria-expanded="false" aria-label="슬라이드 ${index + 1} 작업 메뉴" title="슬라이드 작업">${icon('Ellipsis')}</button></div>`).join('')}</nav></aside><div class="editor-canvas-column">
      <section class="editor-stage" aria-label="슬라이드 캔버스"><div class="canvas-label"><span class="canvas-page">슬라이드 ${String(ui.slideIndex + 1).padStart(2, '0')}</span><div class="canvas-zoom">${tool('축소', 'ZoomOut', 'zoom-out')}<span id="canvas-zoom-value" class="num">${Math.round((ui.canvasZoom ?? 1) * 100)}%</span>${tool('확대', 'ZoomIn', 'zoom-in')}${tool('화면에 맞추기', 'Maximize', 'zoom-fit')}</div></div><div class="preview-well">${renderSlide(slide, ui.slideIndex, d.template)}</div><div class="editor-notes"><span>편집 중</span><span id="canvas-message" role="status">텍스트를 클릭해 수정 / 이미지 모서리로 크기 조절</span></div></section>

      </div><aside id="editor-inspector" ${ui.collapsedInspector ? 'hidden' : ''} class="editor-inspector" aria-label="현재 슬라이드 도구"><div class="inspector-tabs" role="tablist" aria-label="슬라이드 도구"><button type="button" id="editor-chat-tab" role="tab" data-editor-tab="chat" aria-selected="${ui.editorTab !== 'references'}" tabindex="${ui.editorTab !== 'references' ? 0 : -1}">AI와 대화</button><button type="button" id="editor-references-tab" role="tab" data-editor-tab="references" aria-selected="${ui.editorTab === 'references'}" tabindex="${ui.editorTab === 'references' ? 0 : -1}">참고 자료</button></div>${context.chat.view()}<section id="editor-references-panel" role="tabpanel" aria-labelledby="editor-references-tab" ${ui.editorTab === 'references' ? '' : 'hidden'}>${context.pageReferences(slide)}<details><summary>프레젠테이션 전체 자료</summary><section class="asset-basket"><h2>함께 쓸 자료</h2><p>${(d.insertions ?? []).map((item) => esc(item.mode + ': ' + item.title + ' / ' + item.source + ' v' + item.version)).join('<br />') || '별도로 선택한 삽입 자료가 없습니다.'}</p><p class="quiet small">샘플 자료 선택 내역입니다. 실제 발표 파일에는 넣지 않습니다.</p></section></details></section></aside></section>`
    );
  }

  function viewHistory() {
    return (
      pageHeading('작업 이력', '최근 작업과 변경 내용을 확인하세요.', badge('샘플 기록')) +
      activityList(project().history) +
      workflowPanel()
    );
  }
  return { workflowPanel, viewPresentations, viewEditor, viewHistory };
};
