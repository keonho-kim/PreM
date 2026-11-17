// Purpose: Handle validated form submissions and immutable sample revisions.
// Pattern: Feature factory with an explicit application context.
// Usage: Registered before mock/app.js by mock/index.html.
// Related: mock/app.js, mock/index.html.
window.PreMModules.forms = (context) => {
  'use strict';
  const {
    $,
    uid,
    guideFields,
    blocks,
    newProject,
    ui,
    project,
    guide,
    announce,
    log,
    route,
    render,
    closeDialog,
    startGeneration,
    validateFiles,
    metadata,
    changeOutline,
  } = context;
  function submitForm(event) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.dataset.form) return;
    event.preventDefault();
    const data = new FormData(form),
      kind = form.dataset.form;
    if (kind === 'project-filter') return context.submitProjectFilter(form);
    if (kind === 'project-rename') return context.submitProjectRename(form);
    if (kind === 'search') {
      ui.search[ui.view] = String(data.get('q') ?? '').trim();
      render();
      $('#search-input')?.focus();
    } else if (kind === 'new-project' || kind === 'upload') {
      const files = validateFiles(form);
      if (!files) return;
      if (kind === 'new-project') {
        const name = String(data.get('name') ?? '').trim();
        if (!name) {
          $('#new-project-name').setCustomValidity('프로젝트 이름을 입력해 주세요.');
          $('#new-project-name').reportValidity();
          return;
        }
        if (!files.length && !data.has('sample')) {
          $('#upload-files').setCustomValidity('파일을 선택하거나 샘플 문서로 시작을 선택하세요.');
          $('#upload-files').reportValidity();
          return;
        }
        const docs = files.length
          ? metadata(files)
          : [
              {
                id: uid(),
                name: '분기 보고 자료.pdf',
                extension: 'pdf',
                size: 640000,
                pages: 12,
                status: 'completed',
                sample: true,
                at: new Date().toISOString(),
              },
            ];
        const endDate = String(data.get('endDate') ?? '');
        if (!window.PreMModules.projectDates.valid(endDate)) {
          $('#new-project-end-date').setCustomValidity('종료일을 달력에서 선택해 주세요.');
          $('#new-project-end-date').reportValidity();
          return;
        }
        const p = newProject(uid(), name, docs, endDate);
        ui.projectPage = 1;
        context.store.projects.unshift(p);
        ui.projectId = p.id;
        ui.docId = docs[0].id;
        ui.page = 1;
        log('프로젝트 생성', '샘플 프로젝트');
        closeDialog();
        route('documents');
      } else {
        if (!files.length) return;
        project().documents.push(...metadata(files));
        log('원본 파일명 등록', files.length + '개 파일 / 실제 파일 전송 없음');
        closeDialog();
        route('documents');
        announce('파일명과 크기를 목업에 등록했습니다.');
      }
    } else if (kind === 'guide') {
      const previous = guide();
      const next = {
        ...previous,
        schema_version: 3,
        version: previous.version + 1,
        at: new Date().toISOString(),
      };
      for (const [key] of guideFields) next[key] = String(data.get(key) ?? '').trim();
      project().guides.push(next);
      log('작성 방향 v' + next.version + ' 저장', '기존 목차와 프레젠테이션 유지');
      render();
      $('#guide-message').textContent = '작성 방향을 저장했습니다. 이미 만든 PPT는 그대로입니다.';
    } else if (kind === 'outline-add' || kind === 'outline-rename') {
      const title = String(data.get('title') ?? '').trim();
      if (!title) {
        $('#outline-name').setCustomValidity('목차 제목을 입력해 주세요.');
        $('#outline-name').reportValidity();
        return;
      }
      changeOutline((p) => {
        if (kind === 'outline-add') {
          const node = { id: uid(), title, blockIds: [] };
          p.outlines.push(node);
          ui.outlineId = node.id;
        } else p.outlines.find((node) => node.id === ui.outlineId).title = title;
      });
      closeDialog();
      render();
    } else if (kind === 'map') {
      changeOutline((p) => {
        p.outlines.find((node) => node.id === ui.outlineId).blockIds = data
          .getAll('block')
          .filter((id) => blocks.some((block) => block.id === id));
      });
      closeDialog();
      render();
    } else if (kind === 'generate') startGeneration(form);
    else if (kind === 'chat') {
      const instruction = String(data.get('instruction') ?? '').trim();
      if (!instruction) {
        $('#edit-instruction').setCustomValidity('수정할 내용을 입력해 주세요.');
        $('#edit-instruction').reportValidity();
        return;
      }
      context.chat.submit(instruction);
    } else if (kind === 'provider') {
      const name = String(data.get('name') ?? '').trim(),
        model = String(data.get('model') ?? '').trim();
      if (!name || !model) {
        const field = !name ? $('#provider-name') : $('#provider-model');
        const details = field.closest('details');
        if (details) details.open = true;
        field.setCustomValidity('연결 이름과 사용할 AI 이름을 입력해 주세요.');
        field.reportValidity();
        return;
      }
      data.delete('api_key');
      $('#provider-key').value = '';
      context.store.providers.push({
        id: uid(),
        name,
        kind: String(data.get('kind')),
        model,
        version: 1,
        tested: false,
      });
      closeDialog();
      render();
      announce('연결 설정을 저장했습니다 · 샘플');
    } else if (kind === 'routing') {
      context.store.routes = Object.fromEntries(data);
      $('#routing-message').textContent = '업무별 AI 설정을 저장했습니다.';
    }
  }
  return { submitForm };
};
