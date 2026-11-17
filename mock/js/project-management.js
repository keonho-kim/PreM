// Purpose: Own project rename and confirmed deletion in the in-memory mock.
// Pattern: Stable project IDs pin commands independently of the currently open project.
// Usage: Projects view composes this feature; forms and the action dispatcher call its facade.
// Related: project-menu.js, forms.js, views/projects.js.
window.PreMModules.projectManagement = ({
  readProjects,
  readRuns,
  readSelectedId,
  selectProject,
  cancelGeneration,
  esc,
  uid,
  openDialog,
  closeDialog,
  render,
  announce,
}) => {
  const find = (id) => readProjects().find((p) => p.id === id);
  function focus(id) {
    (
      document.querySelector(`[data-project-menu-trigger="${CSS.escape(id ?? '')}"]`) ??
      document.querySelector('[data-project-menu-trigger]') ??
      document.getElementById('main-title')
    )?.focus({ preventScroll: true });
  }
  function rename(target) {
    const p = find(target.dataset.id);
    if (!p) return;
    openDialog(
      '프로젝트 이름 바꾸기',
      `<form class="form-stack" method="post" action="#" data-form="project-rename" data-project-id="${esc(p.id)}" aria-labelledby="dialog-title"><div class="field"><label for="rename-project-name">프로젝트 이름</label><input id="rename-project-name" name="name" value="${esc(p.name)}" maxlength="80" required autofocus /></div><div class="dialog-actions"><button type="button" class="button" data-action="close-dialog">취소</button><button type="submit" class="button primary">이름 저장</button></div></form>`,
    );
  }
  function submit(form) {
    const p = find(form.dataset.projectId);
    if (!p) {
      closeDialog();
      return;
    }
    const name = String(new FormData(form).get('name') ?? '').trim();
    if (!name || Array.from(name).length > 80 || /\p{Cc}/u.test(name)) {
      const input = form.elements.namedItem('name');
      input.setCustomValidity('프로젝트 이름을 1~80자로 입력해 주세요.');
      input.reportValidity();
      return;
    }
    if (p.name !== name) {
      p.name = name;
      p.history.unshift({
        id: uid(),
        title: '프로젝트 이름 변경',
        description: name,
        status: 'completed',
        at: new Date().toISOString(),
      });
    }
    closeDialog();
    render();
    focus(p.id);
    announce('프로젝트 이름을 변경했습니다.');
  }
  function confirm(target) {
    const p = find(target.dataset.id);
    if (!p) return;
    openDialog(
      '프로젝트 삭제',
      `<p class="dialog-intro"><strong>${esc(p.name)}</strong> 프로젝트를 삭제할까요?</p><p>이 목업 세션의 문서·가이드·PPT와 작업 기록이 함께 제거됩니다. 실제 서버의 데이터에는 영향을 주지 않습니다.</p><div class="dialog-actions"><button type="button" class="button" data-action="close-dialog" autofocus>취소</button><button type="button" class="button project-delete-confirm" data-action="confirm-delete-project" data-id="${esc(p.id)}">프로젝트 삭제</button></div>`,
    );
  }
  function remove(target) {
    const id = target.dataset.id,
      projects = readProjects(),
      index = projects.findIndex((p) => p.id === id);
    if (index < 0) {
      closeDialog();
      return;
    }
    const name = projects[index].name,
      runs = readRuns();
    if (runs.some((run) => run.projectId === id && ['running', 'paused'].includes(run.status))) {
      for (const run of runs.filter((item) => item.projectId === id)) run.status = 'cancelled';
      cancelGeneration();
    }
    for (let i = runs.length - 1; i >= 0; i--) if (runs[i].projectId === id) runs.splice(i, 1);
    projects.splice(index, 1);
    if (readSelectedId() === id)
      selectProject(projects.find((p) => p.status === 'active') ?? projects[0]);
    closeDialog();
    render();
    focus(projects[index]?.id ?? projects.at(-1)?.id);
    announce(`${name} 프로젝트를 삭제했습니다.`);
  }
  return {
    submit,
    handlers: {
      'rename-project': rename,
      'delete-project': confirm,
      'confirm-delete-project': remove,
    },
  };
};
