// Purpose: Present team AI settings and work status in ordinary office language.
// Pattern: Local navigation and task-based forms; technical protocol names stay in implementation.
// Usage: Registered before mock/app.js; all connections and responses are samples.
// Related: actions-presentation.js, forms.js, styles/office-workspace.css.
window.PuPuTyXModules.admin = (context) => {
  'use strict';
  const { esc, icon, button, badge, ui, href, pageHeading, empty, workflowPanel } = context;
  const adminTabs = [
    ['providers', 'AI 연결', 'Settings2'],
    ['routing', '업무별 AI', 'ListTree'],
    ['monitor', '작업 현황', 'History'],
    ['system', '서비스 상태', 'CircleCheck'],
  ];
  function connections() {
    return (
      `<div class="section-title"><div><h2>팀에서 사용할 AI</h2><p class="quiet">연결을 추가하고 응답을 확인하세요</p></div>${button('AI 연결 추가', 'new-provider', 'Plus')}</div>` +
      (context.store.providers.length
        ? `<div class="table-scroll"><table><caption class="sr-only">AI 연결 목록 · 샘플</caption><thead><tr><th scope="col">이름</th><th scope="col">AI 서비스</th><th scope="col">연결 확인</th></tr></thead><tbody>${context.store.providers.map((p) => `<tr><th scope="row">${esc(p.name)}</th><td>${esc(p.kind)}</td><td>${button(p.tested ? '확인됨 · 샘플' : '연결 확인', 'test-provider', 'Play', `data-id="${p.id}"`)}</td></tr>`).join('')}</tbody></table></div>`
        : empty(
            '연결된 AI가 없습니다',
            '팀에서 사용할 AI를 추가하세요. 이 화면에서는 샘플로 체험합니다.',
          )) +
      '<p class="sample-note">실제 서비스에 연결하거나 인증 키를 저장하지 않습니다.</p>'
    );
  }
  function routing() {
    const choices = [{ model: '기본 AI', name: '기본 AI' }, ...context.store.providers];
    return `<h2>업무에 맞는 AI 선택</h2><p class="quiet">별도로 선택하지 않으면 기본 AI를 사용합니다</p><form class="form-stack task-notice office-routing" data-form="routing" method="post" action="#" aria-label="업무별 AI">${['자료 읽기', '목차 정리', '내용 정리', '참고 자료 찾기', '자료 적합성 확인', '디자인 추천', '발표 흐름 정리', 'PPT 만들기', '슬라이드 수정', '장표 확인'].map((task, i) => `<div class="field"><label for="route-${i}">${task}</label><select id="route-${i}" name="route-${i}">${choices.map((p) => `<option value="${esc(p.model)}" ${context.store.routes['route-' + i] === p.model ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>`).join('')}<div class="actions"><button type="submit" class="button primary">설정 저장</button></div><p class="form-message" id="routing-message" role="status"></p></form>`;
  }
  function monitor() {
    return (
      '<h2>최근 작업</h2>' +
      (context.store.runs.length
        ? `<div class="table-scroll"><table><caption class="sr-only">최근 작업 목록 · 샘플</caption><thead><tr><th scope="col">작업</th><th scope="col">프로젝트</th><th scope="col">상태</th></tr></thead><tbody>${context.store.runs
            .toReversed()
            .map(
              (run) =>
                `<tr><th scope="row">${esc(run.title)}</th><td>${esc(context.store.projects.find((p) => p.id === run.projectId)?.name)}</td><td>${badge({ running: '만드는 중', paused: '일시 정지', completed: '완료', cancelled: '취소됨' }[run.status], run.status === 'completed' ? 'good' : 'wait')}</td></tr>`,
            )
            .join('')}</tbody></table></div>`
        : empty(
            '아직 진행한 작업이 없습니다',
            'Studio에서 PPT를 만들어 보세요.',
            button('PPT 만들기', 'generate', 'Plus'),
          )) +
      workflowPanel()
    );
  }
  function system() {
    return `<h2>샘플 체험 환경</h2><p class="quiet">실제 서비스 상태를 조회하는 화면은 아닙니다</p><dl class="system-list">${[
      ['자료 추가', '파일 이름만 표시 · 파일 전송 없음'],
      ['PPT 만들기', '샘플 장표 제공'],
      ['AI 대화', '예시 답변 제공'],
      ['변경 내용', '새로고침하면 초기화'],
      ['프로젝트', context.store.projects.length + '개'],
      ['진행한 작업', context.store.runs.length + '개'],
    ]
      .map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`)
      .join(
        '',
      )}</dl><div class="actions task-notice">${button('체험 처음부터 시작', 'reset-confirm', 'RotateCcw')}</div>`;
  }
  function viewAdmin() {
    const views = { providers: connections, routing, monitor, system };
    const tabs = `<details class="office-admin-nav" open><summary>관리 메뉴</summary><nav class="admin-tabs" aria-label="관리 메뉴">${adminTabs.map(([id, label, name]) => `<a href="${href('admin', { tab: id })}" ${ui.adminTab === id ? 'aria-current="page"' : ''}>${icon(name)}${label}</a>`).join('')}</nav></details>`;
    return (
      pageHeading('팀 설정', '팀에서 사용할 AI와 작업 상태를 확인하세요') +
      `<div class="admin-layout office-admin-layout">${tabs}<section class="admin-content admin-${esc(ui.adminTab)}">${(views[ui.adminTab] ?? system)()}</section></div>`
    );
  }
  return { adminTabs, viewAdmin };
};
