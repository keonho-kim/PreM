// Purpose: Manage shared asset metadata and clearly labeled processing simulations.
// Pattern: Narrow feature boundary with owned timer, commands, and derived progress.
// Usage: Composed in app.js; uploads inspect names and sizes only.
// Related: mock/js/uploads.js, mock/styles/space.css, mock/js/views/content.js.
window.PuPuTyXModules.space = (capabilities) => {
  'use strict';
  const {
    $,
    $$,
    esc,
    icon,
    bytes,
    readAssets,
    refreshFeedback,
    readTab,
    href,
    route,
    announce,
    openDialog,
    closeDialog,
    validateFiles,
    metadata,
    pageHeading,
    templateLibrary,
    referenceLibrary,
  } = capabilities;
  const preview = window.PuPuTyXModules.assetPreview({
    $,
    esc,
    icon,
    openDialog,
    templateLibrary,
    renderSlide: capabilities.renderSlide,
    fitSlides: capabilities.fitSlides,
  });
  let timer = null;
  const kind = () => (readTab() === 'templates' ? 'template' : 'reference');
  const stageNames = {
    reference: ['준비 대기 중', '자료 준비 중', '자료 정리 중', '자료 준비 완료'],
    template: ['준비 대기 중', '템플릿 준비 중', '미리보기 준비 중', '템플릿 준비 완료'],
  };
  function items() {
    const library = kind() === 'template' ? templateLibrary : referenceLibrary;
    const samples = library.map((item) => ({
      id: 'library-' + item.id,
      name: item.name ?? item.title,
      kind: kind(),
      status: 'completed',
      step: 3,
      sample: true,
      version: item.version ?? 1,
      detail: kind() === 'template' ? item.layouts.length + '장' : item.tag,
    }));
    return [...readAssets().filter((item) => item.kind === kind()), ...samples];
  }
  function label(item) {
    if (item.sample) return '사용 가능';
    if (item.status === 'paused') return '일시 정지';
    if (item.status === 'cancelled') return '취소됨';
    return stageNames[item.kind][item.step];
  }
  function row(item) {
    return `<li class="asset-row" data-asset-id="${item.id}"><div class="asset-identity">${icon(item.kind === 'template' ? 'PanelsTopLeft' : 'FileText')}<div><button type="button" class="asset-preview-link" data-action="asset-preview" data-id="${esc(item.id)}" aria-label="${esc(item.name)} 미리보기">${esc(item.name)}</button><p>${item.sample ? `샘플 공용 자산 / v${item.version} / ${esc(item.detail)}` : `${bytes(item.size)} / 파일명·크기만 등록됨`}</p></div></div><span data-asset-status>${esc(label(item))}</span>${item.sample ? `<a class="button quiet-button" href="${href(item.kind === 'template' ? 'templates' : 'references')}">Studio에서 선택${icon('ChevronRight')}</a>` : '<span class="quiet small">진행 상황은 우측 하단에서 확인</span>'}</li>`;
  }

  function view() {
    const records = items();
    return (
      pageHeading(
        'Space',
        '팀에서 함께 쓸 자료와 PPT 디자인을 모아 두세요.',
        `<button type="button" class="button primary" data-action="upload-asset">${icon('Upload')}${kind() === 'template' ? '템플릿' : '참고 자료'} 추가</button>`,
      ) +
      `<nav class="space-tabs" aria-label="Space 자산 유형"><a href="${href('space', { tab: 'references' })}" ${kind() === 'reference' ? 'aria-current="page"' : ''}>참고 자료<span>${referenceLibrary.length + readAssets().filter((item) => item.kind === 'reference').length}</span></a><a href="${href('space', { tab: 'templates' })}" ${kind() === 'template' ? 'aria-current="page"' : ''}>템플릿<span>${templateLibrary.length + readAssets().filter((item) => item.kind === 'template').length}</span></a></nav>` +
      `<ul class="asset-list">${records.map(row).join('')}</ul><div class="notice task-notice">${icon('CircleAlert')}<p>샘플 체험입니다. 선택한 파일은 전송하지 않으며 새로고침하면 초기화됩니다.</p></div>`
    );
  }
  function updateIndicators() {
    refreshFeedback();
    for (const item of items()) {
      const node = $$('#workspace [data-asset-id]').find(
        (node) => node.dataset.assetId === item.id,
      );
      if (node) $('[data-asset-status]', node).textContent = label(item);
    }
  }
  function startTimer() {
    if (timer) return;
    timer = setInterval(() => {
      for (const item of readAssets().filter((asset) => asset.status === 'running')) {
        item.step = Math.min(3, item.step + 1);
        if (item.step === 3) {
          item.status = 'completed';
          announce(item.name + '의 준비가 끝났습니다 · 샘플');
        }
      }
      updateIndicators();
      if (!readAssets().some((item) => item.status === 'running')) dispose();
    }, 1200);
  }
  function openUpload() {
    const isTemplate = kind() === 'template';
    openDialog(
      isTemplate ? 'Space에 템플릿 추가' : 'Space에 참고 자료 추가',
      `<p class="dialog-intro">샘플 체험에서는 파일 이름만 표시합니다. 선택한 파일은 전송하지 않습니다.</p><form class="form-stack" data-form="space-upload" method="post" action="#" aria-labelledby="dialog-title"><input type="hidden" name="kind" value="${kind()}" /><div class="field"><label for="asset-files">${isTemplate ? 'PPTX 템플릿' : '참고 자료 문서'} (필수)</label><input type="file" id="asset-files" name="files" multiple required autofocus accept="${isTemplate ? '.pptx' : '.pdf,.hwp,.hwpx,.docx,.pptx,.xlsx,.html,.htm'}" /><p class="field-help">최대 10개, 파일당 50 MiB. 새로고침하면 등록 정보가 초기화됩니다.</p></div><div class="dialog-actions"><button type="button" class="button" data-action="close-dialog">취소</button><button type="submit" class="button primary">추가</button></div></form>`,
    );
  }
  function submit(event) {
    event.preventDefault();
    const form = event.target;
    const type = new FormData(form).get('kind') === 'template' ? 'template' : 'reference';
    const files = validateFiles(
      form,
      type === 'template'
        ? ['pptx']
        : ['pdf', 'hwp', 'hwpx', 'docx', 'pptx', 'xlsx', 'html', 'htm'],
    );
    if (!files?.length) return;
    readAssets().unshift(
      ...metadata(files).map((item) => ({ ...item, kind: type, status: 'running', step: 0 })),
    );
    closeDialog();
    route('space', { tab: type === 'template' ? 'templates' : 'references' });
    startTimer();
    announce('자료를 추가했습니다 · 샘플');
  }
  function dispose() {
    clearInterval(timer);
    timer = null;
  }
  const handlers = {
    ...preview.handlers,
    'template-layouts': (target) => {
      const item = templateLibrary.find((entry) => entry.id === target.dataset.id);
      if (item) preview.openTemplate(item);
    },
    'asset-preview': (target) => {
      const item = items().find((entry) => entry.id === target.dataset.id);
      if (!item) return;
      const source = item.sample
        ? (item.kind === 'template' ? templateLibrary : referenceLibrary).find(
            (entry) => 'library-' + entry.id === item.id,
          )
        : item;
      if (!source) return;
      if (item.kind === 'template') preview.openTemplate(source, !item.sample);
      else preview.openReference(source, !item.sample);
    },
    'upload-asset': openUpload,
    'asset-toggle': (target) => {
      const item = readAssets().find((asset) => asset.id === target.dataset.id);
      if (!item || item.status === 'completed') return;
      if (item.status === 'cancelled') item.step = 0;
      item.status = item.status === 'running' ? 'paused' : 'running';
      if (item.status === 'running') startTimer();
      updateIndicators();
      announce(item.name + ': ' + label(item));
    },
    'asset-cancel': (target) => {
      const item = readAssets().find((asset) => asset.id === target.dataset.id);
      if (!item || ['completed', 'cancelled'].includes(item.status)) return;
      item.status = 'cancelled';
      updateIndicators();
      announce(item.name + '의 준비를 취소했습니다.');
    },
  };
  return { view, submit, handlers, updateIndicators, dispose };
};
