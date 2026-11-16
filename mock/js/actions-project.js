// Purpose: Own explicit user actions for the current feature scope.
// Pattern: Feature factory with an explicit application context.
// Usage: Registered before mock/app.js by mock/index.html.
// Related: mock/app.js, mock/index.html.
window.PuPuTyXModules['actions-project'] = (context) => {
  'use strict';
  const {
    $,
    esc,
    icon,
    clone,
    uid,
    button,
    guideFields,
    blocks,
    ui,
    project,
    announce,
    log,
    selectedTemplate,
    render,
    openDialog,
    closeDialog,
    cancelButton,
    openUpload,
    openGeneration,
    changeOutline,
    moveOutline,
    openDocumentPage,
  } = context;
  const handlers = {
    'switch-project': () =>
      openDialog(
        '프로젝트 전환',
        `<ul class="project-picker">${context.store.projects
          .filter((item) => item.status === 'active')
          .map(
            (item) =>
              `<li><a href="#${new URLSearchParams({ view: 'overview', project: item.id })}" aria-current="${item.id === ui.projectId}">${icon('FolderOpen')}<span>${esc(item.name)}</span>${item.id === ui.projectId ? icon('Check') : ''}</a></li>`,
          )
          .join('')}</ul>`,
      ),
    'filter-projects': (target) => {
      ui.projectFilter = target.dataset.value;
      ui.projectPage = 1;
      render();
    },
    'close-dialog': closeDialog,
    help: () =>
      openDialog(
        '사용 안내',
        '<div class="dialog-content-stack"><p>Home에서 프로젝트를 열고 Studio에서 자료와 작성 방향을 정한 뒤 PPT를 만들어 보세요. 함께 쓸 자료와 디자인은 Space에서 관리합니다.</p><p>샘플 체험 화면입니다. 실제 AI를 사용하지 않으며 새로고침하면 변경 내용이 초기화됩니다.</p><p>선택한 파일은 전송하지 않습니다. 체험 내용 저장은 발표 파일이 아닌 체험 기록을 내려받습니다.</p><div class="actions">' +
          button('샘플 초기화', 'reset-confirm', 'RotateCcw') +
          '</div></div>',
      ),
    'new-project': () => openUpload(true),
    upload: () => openUpload(false),
    generate: openGeneration,
    'select-doc': (target) => {
      ui.docId = target.dataset.id;
      ui.page = 1;
      render();
    },
    'open-doc-page': (target) => openDocumentPage(Number(target.dataset.page)),
    'doc-prev': () => openDocumentPage(ui.page - 1),
    'doc-next': () => openDocumentPage(ui.page + 1),
    'retry-doc': (target) => {
      const doc = project().documents.find((item) => item.id === target.dataset.id);
      if (doc) doc.status = 'completed';
      render();
      announce('샘플 오류 상태를 해제했습니다.');
    },
    'clone-project': (target) => {
      const original = context.store.projects.find((p) => p.id === target.dataset.id);
      if (!original) return;
      const copied = clone(original);
      copied.id = uid();
      copied.name += ' 복사본';
      copied.status = 'active';
      context.store.projects.unshift(copied);
      render();
      announce('샘플 프로젝트를 복제했습니다.');
    },
    'archive-project': (target) => {
      const p = context.store.projects.find((item) => item.id === target.dataset.id);
      if (!p) return;
      p.status = p.status === 'archived' ? 'active' : 'archived';
      render();
      announce(
        p.status === 'archived'
          ? '프로젝트를 보관했습니다. 보관됨 필터에서 복원할 수 있습니다.'
          : '프로젝트를 복원했습니다.',
      );
    },
    'view-guide': (target) => {
      const revision = project().guides.find(
        (rev) => rev.version === Number(target.dataset.version),
      );
      if (!revision) return;
      openDialog(
        '작성 방향 · 버전 ' + revision.version,
        `<dl class="guide-revision-preview">${guideFields.map(([key, label]) => `<div><dt>${label}</dt><dd>${esc(revision[key] || '입력 없음')}</dd></div>`).join('')}</dl>`,
      );
    },
    'select-outline': (target) => {
      ui.outlineId = target.dataset.id;
      render();
    },
    'add-outline': () =>
      openDialog(
        '목차 추가',
        '<form class="form-stack" method="post" action="#" data-form="outline-add" aria-labelledby="dialog-title"><div class="field"><label for="outline-name">목차 제목 (필수)</label><input id="outline-name" name="title" maxlength="80" required autofocus /></div><div class="dialog-actions">' +
          cancelButton +
          '<button type="submit" class="button primary">목차 추가</button></div></form>',
      ),
    'rename-outline': () => {
      const node = project().outlines.find((item) => item.id === ui.outlineId);
      if (!node) return;
      openDialog(
        '목차 제목 수정',
        `<form class="form-stack" method="post" action="#" data-form="outline-rename" aria-labelledby="dialog-title"><div class="field"><label for="outline-name">목차 제목 (필수)</label><input id="outline-name" name="title" maxlength="80" value="${esc(node.title)}" required autofocus /></div><div class="dialog-actions">${cancelButton}<button type="submit" class="button primary">제목 저장</button></div></form>`,
      );
    },
    'outline-up': () => moveOutline(-1),
    'outline-down': () => moveOutline(1),
    unmap: (target) => {
      changeOutline((p) => {
        const node = p.outlines.find((item) => item.id === ui.outlineId);
        node.blockIds = node.blockIds.filter((id) => id !== target.dataset.id);
      });
      render();
    },
    'map-block': () => {
      const node = project().outlines.find((item) => item.id === ui.outlineId);
      if (!node) return;
      openDialog(
        '내용 담기',
        `<p class="dialog-intro">이 목차에 사용할 내용을 선택하세요. 같은 내용을 다른 목차에도 담을 수 있습니다.</p><form class="form-stack" method="post" action="#" data-form="map" aria-labelledby="dialog-title">${blocks.map((block) => `<label class="check-row"><input type="checkbox" name="block" value="${block.id}" ${node.blockIds.includes(block.id) ? 'checked' : ''} />${esc(block.title)} (${block.page}쪽)</label>`).join('')}<div class="dialog-actions">${cancelButton}<button type="submit" class="button primary">연결 저장</button></div></form>`,
      );
    },
    'select-reference': (target) => {
      ui.referenceId = target.dataset.id;
      render();
    },
    'toggle-reference': (target) => {
      const p = project(),
        id = target.dataset.id;
      p.selectedRefs = p.selectedRefs.includes(id)
        ? p.selectedRefs.filter((value) => value !== id)
        : [...p.selectedRefs, id];
      log('참고 자료 선택 변경', `${p.selectedRefs.length}개 자료 선택`);
      render();
    },
    'select-template': (target) => {
      project().template = target.dataset.id;
      log('템플릿 선택 변경', selectedTemplate().name);
      render();
      announce('다음 생성 작업에 적용할 템플릿을 선택했습니다.');
    },
  };
  return { handlers };
};
