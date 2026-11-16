// Purpose: Track explicit, revision-aware review progress for the Studio workflow.
// Pattern: Feature commands own confirmations; rendering consumes a derived read model.
// Usage: Composed by app.js; all state stays in the current project in memory.
// Related: mock/js/chrome.js, mock/js/forms.js, mock/styles/workspace-flow.css.
window.PuPuTyXModules.studio = (capabilities) => {
  'use strict';
  const { $, readProject, readView, readRuns, esc, icon, href, route, announce } = capabilities;
  const steps = [
    ['documents', '자료 추가'],
    ['guide', '작성 방향'],
    ['outline', '목차 정리'],
    ['references', '참고 자료'],
    ['templates', '디자인 선택'],
    ['presentations', 'PPT 만들기'],
  ];
  const isStudio = (view) =>
    ['overview', 'history', 'editor', ...steps.map(([id]) => id)].includes(view);
  const stage = (view) => (view === 'editor' ? 'presentations' : view);
  function fingerprints(p) {
    return {
      documents: JSON.stringify(p.documents.map((doc) => doc.id)),
      guide: String(p.guides.at(-1).version),
      outline: String(p.outlineVersion),
      references: JSON.stringify([[...p.selectedRefs].sort(), p.selectedInsertions ?? []]),
      templates: p.template,
    };
  }
  function readProgress() {
    const p = readProject(),
      keys = fingerprints(p);
    const confirmed = p.studioConfirmed ?? {};
    const run = readRuns().findLast((item) => item.projectId === p.id);
    return steps.map(([id, label]) => {
      const available =
        id === 'documents'
          ? p.documents.length > 0
          : id === 'outline'
            ? p.outlines.length > 0
            : true;
      const complete =
        id === 'presentations'
          ? p.decks.length > 0 && !['running', 'paused'].includes(run?.status)
          : available && confirmed[id] === keys[id];
      const status =
        id === 'presentations' && ['running', 'paused'].includes(run?.status)
          ? run.status === 'paused'
            ? '일시 정지'
            : '생성 중'
          : complete
            ? '완료'
            : confirmed[id]
              ? '변경됨'
              : '확인 필요';
      return { id, label, complete, available, status };
    });
  }
  function stepper() {
    if (!isStudio(readView())) return '';
    const current = stage(readView());
    const progress = readProgress();
    const markup = `<section class="studio-progress" aria-label="Studio 제작 진도"><div class="studio-progress-title"><strong>PPT 만들기</strong><span>${progress.filter((step) => step.complete).length} / ${steps.length}단계 완료</span></div><nav data-active-scroll aria-label="PPT 제작 단계"><ol class="studio-stepper">${progress.map((step, index) => `<li class="${step.complete ? 'is-complete' : ''}"><a href="${href(step.id)}" aria-label="${step.label} · ${step.status}" ${current === step.id ? 'aria-current="step"' : ''}><span class="step-number" aria-hidden="true">${step.complete ? icon('Check') : index + 1}</span><span><strong class="step-label-full">${step.label}</strong><strong class="step-label-short" aria-hidden="true">${['자료', '방향', '목차', '근거', '디자인', '생성'][index]}</strong><small>${step.status}</small></span></a></li>`).join('')}</ol></nav></section>`;
    return markup;
  }
  function footer() {
    const current = stage(readView());
    const index = steps.findIndex(([id]) => id === current);
    if (index < 0) return '';
    const step = readProgress()[index];
    return `<div class="studio-next"><p>${index === steps.length - 1 ? '완성된 PPT를 열어 내용을 다듬어 보세요.' : step.complete ? '확인한 내용입니다. 다음 단계로 이동하세요.' : '이 단계의 내용을 확인한 뒤 다음 작업으로 이동하세요.'}</p><div class="actions">${index > 0 ? `<a class="button quiet-button" href="${href(steps[index - 1][0])}">${icon('ArrowLeft')}이전 단계</a>` : ''}${index < steps.length - 1 ? `<button type="button" class="button" data-action="confirm-studio-step" ${step.available ? '' : 'disabled'}>${icon('Check')}확인하고 다음</button>` : `<a class="button quiet-button" href="${href('history')}">작업 이력</a>`}</div></div>`;
  }
  function confirm() {
    const id = stage(readView());
    const index = steps.findIndex(([key]) => key === id);
    if (index < 0 || index === steps.length - 1 || !readProgress()[index].available) return;
    const p = readProject();
    const form = $('form[data-form="guide"]');
    if (
      form &&
      [...new FormData(form)].some(
        ([key, value]) => String(value).trim() !== String(p.guides.at(-1)[key] ?? ''),
      )
    ) {
      $('#guide-message').textContent = '변경한 작성 방향을 먼저 저장한 뒤 다음 단계로 이동하세요.';
      announce('저장하지 않은 작성 방향이 있습니다. 먼저 저장해 주세요.');
      return;
    }
    p.studioConfirmed ??= {};
    p.studioConfirmed[id] = fingerprints(p)[id];
    announce(steps[index][1] + ' 단계를 확인했습니다.');
    route(steps[index + 1][0]);
  }
  function contextBar() {
    if (!isStudio(readView())) return '';
    return `<div class="studio-context"><button type="button" class="project-switch" data-action="switch-project" aria-label="${esc(readProject().name)} 프로젝트 전환"><strong id="current-project">${esc(readProject().name)}</strong>${icon('ChevronDown')}</button><div class="actions"><a href="${href('overview')}" ${readView() === 'overview' ? 'aria-current="page"' : ''}>프로젝트 개요</a><a href="${href('history')}" ${readView() === 'history' ? 'aria-current="page"' : ''}>작업 이력</a></div></div>`;
  }
  return { isStudio, readProgress, stepper, footer, contextBar, confirm };
};
