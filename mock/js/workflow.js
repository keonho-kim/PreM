// Purpose: Run the cancellable sample presentation generation sequence.
// Pattern: Feature factory with an explicit application context.
// Usage: Registered before mock/app.js by mock/index.html.
// Related: mock/app.js, mock/index.html.
window.PuPuTyXModules.workflow = (context) => {
  'use strict';
  const { $, $$, clone, uid, makeSlides, ui, project, announce, route, render, closeDialog } =
    context;
  function generationMessage(run) {
    if (run.status === 'completed') return 'PPT가 준비됐습니다. 열어서 내용을 확인하세요.';
    if (run.status === 'cancelled') return '만들기를 취소했습니다. 기존 PPT는 그대로입니다.';
    if (run.status === 'paused') return '잠시 멈췄습니다. 준비되면 이어가세요.';
    return run.step < 3
      ? '선택한 자료로 PPT를 만들고 있습니다.'
      : '완성된 장표를 준비하고 있습니다.';
  }
  function startGeneration(form) {
    const data = new FormData(form),
      p = project();
    const selected = data
      .getAll('outline')
      .filter((id) => p.outlines.some((node) => node.id === id));
    if (!selected.length) {
      $('#generation-error').textContent = '대상 목차를 하나 이상 선택해 주세요.';
      $('#generation-error').focus();
      return;
    }
    const run = {
      id: uid(),
      sessionTask: true,
      projectId: p.id,
      title: String(data.get('title')).trim(),
      guideVersion: Number(data.get('guide')),
      outlineVersion: p.outlineVersion,
      template: String(data.get('template')),
      count: Math.max(1, Math.min(12, Number(data.get('count')))),
      notes: String(data.get('notes') ?? ''),
      selected: p.outlines.filter((node) => selected.includes(node.id)).map((node) => node.title),
      references: [...p.selectedRefs],
      insertions: clone(p.selectedInsertions ?? []),
      status: 'running',
      step: 0,
    };
    context.store.runs.push(run);
    closeDialog();
    route('presentations');
    context.refreshFeedback();
    clearInterval(context.generationTimer);
    context.generationTimer = setInterval(() => {
      if (run.status !== 'running') return;
      run.step += 1;
      context.refreshFeedback();
      if (run.step >= 6) {
        run.status = 'completed';
        context.refreshFeedback();
        clearInterval(context.generationTimer);
        const slides = makeSlides(run.title, run.count, run.selected);
        const output = {
          id: uid(),
          title: run.title,
          guideVersion: run.guideVersion,
          outlineVersion: run.outlineVersion,
          template: run.template,
          references: run.references,
          insertions: run.insertions,
          notes: run.notes,
          version: 1,
          slides,
          revisions: [{ version: 1, at: new Date().toISOString(), slides: clone(slides) }],
        };
        p.decks.unshift(output);
        p.history.unshift({
          id: uid(),
          title: '샘플 프레젠테이션 구성',
          description: `${slides.length}개 슬라이드 / 가이드 v${run.guideVersion}`,
          status: 'completed',
          at: new Date().toISOString(),
        });
        if (
          ui.projectId === p.id &&
          ['presentations', 'history', 'overview', 'admin'].includes(ui.view)
        )
          render();
        announce('샘플 슬라이드 구성이 완료되었습니다. 편집 화면에서 확인하세요.');
      } else if (ui.projectId === p.id) {
        $$('[data-run-progress]').forEach((node) => {
          node.value = run.step;
        });
        $$('[data-run-description]').forEach((node) => {
          node.textContent = generationMessage(run);
        });
      }
    }, 650);
  }
  return { startGeneration, generationMessage };
};
