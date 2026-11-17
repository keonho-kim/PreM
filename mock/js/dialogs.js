// Purpose: Build native dialog contents for project, generation, and revision flows.
// Pattern: Feature factory with an explicit application context.
// Usage: Registered before mock/app.js by mock/index.html.
// Related: mock/app.js, mock/index.html.
window.PreMModules.dialogs = (context) => {
  'use strict';
  const { esc, icon, templateLibrary, ui, project, guide, deck, openDialog, cancelButton } =
    context;
  function openUpload(create = false) {
    const label = create ? '프로젝트 만들기' : '원본 문서 추가';
    openDialog(
      label,
      `<p class="dialog-intro">목업은 파일명과 크기만 사용합니다. 파일 내용을 읽거나 외부로 전송하지 않습니다.</p><form class="form-stack" data-form="${create ? 'new-project' : 'upload'}" method="post" action="#" aria-labelledby="dialog-title">${create ? '<div class="field"><label for="new-project-name">프로젝트 이름 (필수)</label><input id="new-project-name" name="name" required maxlength="80" autofocus /><label class="check-row"><input type="checkbox" name="sample" checked />샘플 문서로 시작</label></div><div class="field"><label for="new-project-end-date">종료일 (필수)</label><input id="new-project-end-date" name="endDate" type="date" min="1900-01-01" max="9999-12-31" required aria-describedby="project-end-date-help" /><p class="field-help" id="project-end-date-help">달력에서 날짜를 선택하세요. 카드의 D-Day는 이 날짜를 기준으로 표시됩니다.</p></div>' : ''}<div class="field"><label for="upload-files">원본 문서${create ? '' : ' (필수)'}</label><input id="upload-files" type="file" name="files" multiple ${create ? '' : 'required autofocus'} accept=".pdf,.hwp,.hwpx,.docx,.pptx,.xlsx" aria-describedby="upload-help" /><p class="field-help" id="upload-help">PDF, HWP, HWPX, DOCX, PPTX, XLSX. 최대 10개, 파일당 50 MiB. ${create ? '파일을 선택하면 해당 파일 이름으로 시작합니다.' : '등록 정보는 새로고침하면 초기화됩니다.'}</p></div><div class="dialog-actions">${cancelButton}<button class="button primary" type="submit">${icon('Upload')}${create ? '프로젝트 생성' : '목업에 등록'}</button></div></form>`,
    );
  }

  function openGeneration() {
    if (context.store.runs.some((run) => run.status === 'running' || run.status === 'paused')) {
      openDialog(
        '진행 중인 샘플 작업',
        '<p class="dialog-intro">기존 샘플 생성 작업을 완료하거나 취소한 뒤 새 구성을 시작하세요.</p><div class="dialog-actions"><button type="button" class="button" data-action="show-running">진행 확인</button></div>',
      );
      return;
    }
    const p = project();
    if (!p.outlines.length) {
      openDialog(
        '목차가 필요합니다',
        '<p class="dialog-intro">목차 정리 화면에서 발표할 내용을 먼저 추가하세요.</p>',
      );
      return;
    }
    openDialog(
      '프레젠테이션 구성',
      `<p class="dialog-intro">목차와 디자인을 확인해 주세요. 샘플 슬라이드를 만들며 실제 발표 파일은 생성하지 않습니다.</p><form class="form-stack" data-form="generate" method="post" action="#" aria-labelledby="dialog-title"><div class="field"><label for="deck-title">프레젠테이션 이름 (필수)</label><input id="deck-title" name="title" value="${esc(p.name)}" required maxlength="80" autofocus /></div><div class="two-fields"><div class="field"><label for="generation-guide">작성 방향</label><select id="generation-guide" name="guide">${p.guides
        .toReversed()
        .map(
          (rev) =>
            `<option value="${rev.version}">작성 방향 ${rev.version}${rev.version === guide().version ? ' (최신)' : ''}</option>`,
        )
        .join(
          '',
        )}</select></div><div class="field"><label for="slide-count">슬라이드 수</label><input id="slide-count" name="count" type="number" min="1" max="12" value="6" required /></div></div><fieldset class="form-stack"><legend>대상 목차</legend>${p.outlines.map((node) => `<label class="check-row"><input type="checkbox" name="outline" value="${node.id}" checked />${esc(node.title)}</label>`).join('')}</fieldset><div class="field"><label for="generation-template">디자인 템플릿</label><select id="generation-template" name="template">${templateLibrary.map((item) => `<option value="${item.id}" ${p.template === item.id ? 'selected' : ''}>${item.name}</option>`).join('')}</select></div><div class="field"><label for="generation-notes">추가 요청 (선택)</label><textarea id="generation-notes" name="notes" maxlength="800"></textarea></div><p class="error-message" id="generation-error" role="alert" tabindex="-1"></p><div class="dialog-actions">${cancelButton}<button class="button primary" type="submit">${icon('Presentation')}PPT 만들기 · 샘플</button></div></form>`,
    );
  }

  function exportDeck(id) {
    const d = project().decks.find((item) => item.id === id) ?? deck();
    if (!d) return;
    const output = {
      schema_version: 1,
      mock: true,
      title: d.title,
      guide_revision: d.guideVersion,
      outline_revision: d.outlineVersion,
      template: d.template,
      version: d.version,
      source_insertions: d.insertions ?? [],
      slides: d.slides,
    };
    openDialog(
      '체험 내용 저장',
      `<p class="dialog-intro">체험한 내용을 보관용 파일로 저장합니다. PowerPoint에서 여는 발표 파일은 아닙니다.</p><dl class="guide-revision-preview"><div><dt>프레젠테이션</dt><dd>${esc(d.title)}</dd></div><div><dt>포함할 슬라이드</dt><dd>${d.slides.length}개 / 버전 v${d.version}</dd></div></dl><div class="dialog-actions"><button type="button" class="button" data-action="close-dialog">닫기</button><button type="button" class="button primary" data-action="download-json" data-id="${d.id}">${icon('Download')}체험 내용 저장</button></div>`,
    );
    ui.exportData = output;
  }
  function bindDialogLifecycle(dialog) {
    const events = new AbortController();
    dialog.addEventListener(
      'close',
      () => {
        dialog.returnValue = '';
        dialog.querySelectorAll('input[type="password"]').forEach((field) => {
          field.value = '';
        });
      },
      { signal: events.signal },
    );
    if (!('closedBy' in HTMLDialogElement.prototype)) {
      let outside = false;
      const isOutside = (e) => {
        const r = dialog.getBoundingClientRect();
        return (
          e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom
        );
      };
      dialog.addEventListener(
        'pointerdown',
        (e) => {
          outside = isOutside(e);
        },
        { signal: events.signal },
      );
      dialog.addEventListener(
        'pointerup',
        (e) => {
          if (outside && isOutside(e)) dialog.close();
        },
        { signal: events.signal },
      );
    }
    return () => events.abort();
  }
  return { openUpload, openGeneration, exportDeck, bindDialogLifecycle };
};
