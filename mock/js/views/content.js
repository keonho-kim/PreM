// Purpose: Render guide authoring, source mapping, and selected library assets.
// Pattern: Feature factory with an explicit application context.
// Usage: Registered before mock/app.js by mock/index.html.
// Related: mock/app.js, mock/styles/content-workspace.css.
window.PuPuTyXModules.content = (context) => {
  'use strict';
  const {
    esc,
    icon,
    button,
    badge,
    formatDate,
    guideFields,
    blocks,
    templateLibrary,
    referenceLibrary,
    ui,
    project,
    guide,
    pageHeading,
    empty,
    searchForm,
  } = context;
  function guideField([key, label], current) {
    const id = `guide-${key}`;
    const input = `<textarea id="${id}" name="${key}" maxlength="2000" placeholder="${key === 'do' ? '예: 핵심 근거를 먼저, 한 장에 메시지 하나' : '예: 근거 없는 주장, 과도한 장식은 제외'}">${esc(current[key] ?? '')}</textarea>`;
    return `<div class="field ${key === 'free' ? 'guide-free-field' : ''}"><label for="${id}">${label}</label>${input}</div>`;
  }

  function viewGuide() {
    const current = guide();
    const groups = [['작성 요청 (선택)', guideFields]];
    return (
      pageHeading(
        '작성 방향',
        '원하는 것과 피할 것만 알려주세요. 비워 두어도 됩니다.',
        badge('저장됨', 'good'),
      ) +
      `<div class="guide-grid"><form class="form-stack" id="guide-form" data-form="guide" action="#" method="post" aria-labelledby="main-title">${groups.map(([title, fields]) => `<fieldset class="guide-section"><legend>${title}</legend><div class="guide-fields">${fields.map((field) => guideField(field, current)).join('')}</div></fieldset>`).join('')}<div class="guide-save"><div class="actions"><button type="submit" class="button primary">${icon('Check')}작성 방향 저장</button><span class="quiet small">목차와 PPT는 그대로 유지됩니다.</span></div><p class="form-message" role="status" id="guide-message"></p></div></form><details class="guide-aside guide-history"><summary>저장 기록</summary><div class="guide-history-content"><ul class="revision-list" role="list">${project()
        .guides.toReversed()
        .map(
          (rev) =>
            `<li><span>${badge('v' + rev.version, rev.version === current.version ? 'good' : '')}</span><span class="quiet small">${formatDate(rev.at)}</span><button class="button quiet-button" type="button" data-action="view-guide" data-version="${rev.version}">내용 확인${icon('ChevronRight')}</button></li>`,
        )
        .join(
          '',
        )}</ul><div class="notice">${icon('CircleAlert')}<p>저장한 작성 방향은 다음 PPT를 만들 때 사용합니다. 이미 만든 PPT는 그대로입니다.</p></div></div></details></div>`
    );
  }

  function viewOutline() {
    const p = project(),
      node = p.outlines.find((item) => item.id === ui.outlineId) ?? p.outlines[0];
    if (node) ui.outlineId = node.id;
    return (
      pageHeading(
        '목차 정리',
        '목차를 선택하고 연결된 원문 근거를 검토하세요.',
        button('목차 추가', 'add-outline', 'Plus'),
      ) +
      (node
        ? `<div class="mapping-layout mapping-workspace"><section class="outline-strip" aria-labelledby="outline-list-title"><div class="outline-strip-heading"><h2 id="outline-list-title">발표 순서</h2><div class="actions">${button('위로', 'outline-up', 'ArrowUp')}${button('아래로', 'outline-down', 'ArrowDown')}</div></div><ol data-active-scroll class="outline-tree" role="list">${p.outlines.map((item, index) => `<li><button type="button" data-action="select-outline" data-id="${item.id}" aria-pressed="${item.id === node.id}"><span class="num">${index + 1}</span>${esc(item.title)}<small>${item.blockIds.length}</small></button></li>`).join('')}</ol></section><div class="mapping-panes"><section class="mapping-content"><div class="section-title"><h2>${esc(node.title)}</h2>${button('제목 수정', 'rename-outline', null)}</div><div class="block-list" role="region" aria-label="사용할 내용" tabindex="0">${
            node.blockIds.length
              ? node.blockIds
                  .map((id) => blocks.find((block) => block.id === id))
                  .filter(Boolean)
                  .map(
                    (block) =>
                      `<article class="content-block"><div class="block-meta"><span class="source-reference">원본 ${block.page}쪽</span><button type="button" class="icon-button" data-action="unmap" data-id="${block.id}" aria-label="${esc(block.title)} 연결 제거">${icon('X')}</button></div><h3>${esc(block.title)}</h3><p>${esc(block.text)}</p></article>`,
                  )
                  .join('')
              : '<p class="quiet">아직 연결한 내용가 없습니다. 내용 담기을 선택하세요.</p>'
          }</div><div class="actions task-notice">${button('내용 담기', 'map-block', 'Plus')}</div></section><aside class="mapping-source" aria-labelledby="mapping-source-title" tabindex="0"><h2 id="mapping-source-title">원문 근거</h2><p>${esc(blocks.find((block) => block.id === node.blockIds[0])?.text ?? '연결한 근거가 없습니다. 내용 담기에서 원문 내용을 선택하세요.')}</p><p class="source-caption">분기 보고 자료 · 원문 보기</p></aside></div></div>`
        : empty(
            '목차를 추가하세요',
            '목차와 사용할 내용을 함께 관리합니다.',
            button('목차 추가', 'add-outline', 'Plus'),
          ))
    );
  }

  const discovery = window.PuPuTyXModules.assetSearch({
    esc,
    icon,
    project,
    ui,
    referenceLibrary,
    templateLibrary,
    pageHeading,
    searchForm,
    renderSlide: context.renderSlide,
    deck: context.deck,
    clone: context.clone,
    commitSlides: context.commitSlides,
    openDialog: context.openDialog,
    render: context.render,
    announce: context.announce,
    href: context.href,
  });
  return {
    viewGuide,
    viewOutline,
    viewReferences: discovery.references,
    viewTemplates: discovery.templates,
    chooseAsset: discovery.choose,
    pageReferences: discovery.pageReferences,
    assetHandlers: discovery.handlers,
  };
};
