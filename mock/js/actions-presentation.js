// Purpose: Own explicit user actions for the current feature scope.
// Pattern: Feature factory with an explicit application context.
// Usage: Registered before mock/app.js by mock/index.html.
// Related: mock/app.js, mock/index.html.
window.PreMModules['actions-presentation'] = (context) => {
  'use strict';
  const {
    clone,
    uid,
    button,
    badge,
    formatDate,
    seed,
    ui,
    project,
    deck,
    href,
    announce,
    log,
    route,
    render,
    openDialog,
    closeDialog,
    cancelButton,
    commitSlides,
    exportDeck,
  } = context;
  const handlers = {
    'select-slide': (target) => {
      ui.slideIndex = Number(target.dataset.index);
      render();
    },
    'slide-prev': () => {
      ui.slideIndex = Math.max(0, ui.slideIndex - 1);
      render();
    },
    'slide-next': () => {
      ui.slideIndex = Math.min(deck().slides.length - 1, ui.slideIndex + 1);
      render();
    },
    'add-slide': () => context.slideCommands.insert(),
    'duplicate-slide': () => context.slideCommands.duplicate(),
    'delete-slide': () => context.slideCommands.remove(),
    'deck-revisions': () => {
      const d = deck();
      openDialog(
        '프레젠테이션 버전',
        `<ul class="revision-list">${d.revisions
          .toReversed()
          .map(
            (revision) =>
              `<li><div class="section-title"><h3>버전 v${revision.version}</h3>${revision.version === d.version ? badge('현재', 'good') : button('이 버전 복원', 'restore-deck', 'RotateCcw', `data-version="${revision.version}"`)}</div><span class="quiet small">${revision.slides.length}개 슬라이드 / ${formatDate(revision.at)}</span></li>`,
          )
          .join('')}</ul><p class="quiet small">복원해도 이후 변경 기록은 남습니다.</p>`,
      );
    },
    'restore-deck': (target) => {
      const revision = deck().revisions.find(
        (rev) => rev.version === Number(target.dataset.version),
      );
      if (!revision) return;
      const slides = clone(revision.slides);
      closeDialog();
      ui.slideIndex = 0;
      commitSlides(slides, '이전 슬라이드 버전 복원');
    },
    export: (target) => exportDeck(target.dataset.id),
    'download-json': () => {
      if (!ui.exportData) return;
      const blob = new Blob([JSON.stringify(ui.exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'PreM-mock-presentation.json';
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      closeDialog();
      announce('체험 내용을 저장했습니다.');
    },
    'toggle-run': () => {
      const run = context.store.runs.findLast(
        (item) => item.projectId === project().id && ['running', 'paused'].includes(item.status),
      );
      if (!run) return;
      run.status = run.status === 'paused' ? 'running' : 'paused';
      render();
    },
    'cancel-run': () => {
      const run = context.store.runs.findLast(
        (item) => item.projectId === project().id && ['running', 'paused'].includes(item.status),
      );
      if (!run) return;
      run.status = 'cancelled';
      clearInterval(context.generationTimer);
      log('샘플 생성 취소', run.title, 'cancelled');
      render();
      announce('기존 프레젠테이션을 유지하고 샘플 생성을 취소했습니다.');
    },
    'show-running': () => {
      const run = context.store.runs.findLast((item) =>
        ['running', 'paused'].includes(item.status),
      );
      closeDialog();
      if (run) {
        ui.projectId = run.projectId;
        route('presentations');
      }
    },
    'new-provider': () =>
      openDialog(
        'AI 연결 추가',
        '<p class="dialog-intro">샘플로 연결을 추가해 보세요. 실제 인증 키는 입력하지 않아도 됩니다.</p><form class="form-stack" method="post" action="#" data-form="provider" aria-labelledby="dialog-title"><div class="field"><label for="provider-name">표시 이름 (필수)</label><input id="provider-name" name="name" required maxlength="80" autofocus /></div><div class="field"><label for="provider-kind">AI 서비스</label><select id="provider-kind" name="kind"><option>OpenAI</option><option>Claude</option><option>Gemini</option><option>llama.cpp</option><option>SGLang</option><option>vLLM</option><option>LiteLLM</option></select></div><details class="office-connection-details"><summary>세부 연결 정보</summary><div class="field"><label for="provider-model">사용할 AI 이름</label><input id="provider-model" name="model" value="sample-vision-model" maxlength="100" /></div><div class="field"><label for="provider-key">인증 키 (선택)</label><input id="provider-key" type="password" name="api_key" autocomplete="off" placeholder="실제 키를 입력할 필요가 없습니다" /><p class="field-help">입력한 키는 저장하지 않습니다.</p></div></details><div class="dialog-actions">' +
          cancelButton +
          '<button type="submit" class="button primary">저장</button></div></form>',
      ),
    'test-provider': (target) => {
      const provider = context.store.providers.find((item) => item.id === target.dataset.id);
      if (!provider) return;
      provider.tested = true;
      render();
      announce('샘플 응답을 확인했습니다. 실제 서비스에 연결하지는 않았습니다.');
    },
    'reset-confirm': () =>
      openDialog(
        '샘플 데이터 초기화',
        '<p class="dialog-intro">이 목업 세션의 변경을 지우고 처음 샘플로 돌아갑니다. 실제 프로젝트 데이터에는 영향을 주지 않습니다.</p><div class="dialog-actions"><button type="button" class="button" data-action="close-dialog" autofocus>유지하기</button><button type="button" class="button primary" data-action="reset">샘플 초기화</button></div>',
      ),
    reset: () => {
      clearInterval(context.generationTimer);
      context.store = seed();
      Object.assign(ui, {
        projectId: 'platform',
        deckId: 'deck1',
        slideIndex: 0,
        outlineId: 'o1',
        docId: 'doc1',
        page: 1,
        search: {},
        projectFilter: 'active',
        projectSort: 'recent',
        projectPage: 1,
        projectDateFrom: '',
        projectDateTo: '',
      });
      closeDialog();
      if (location.hash === href('overview')) render();
      else route('overview');
      announce('초기 샘플로 돌아왔습니다.');
    },
  };
  return { handlers };
};
