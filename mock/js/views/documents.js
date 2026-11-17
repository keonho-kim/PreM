// Purpose: Render a sample document gallery and an explicit full-page reader.
// Pattern: Feature factory with owned, disposable preview hydration.
// Usage: Render first, enhance the attached gallery, and dispose before route changes.
// Related: mock/app.js, mock/styles/document-gallery.css, mock/js/data.js.
window.PreMModules.documents = (context) => {
  'use strict';
  const {
    esc,
    icon,
    button,
    bytes,
    blocks,
    ui,
    project,
    docStatus,
    pageHeading,
    empty,
    searchForm,
    openDialog,
  } = context;
  let galleryRoot;
  let previewObserver;
  let fallbackEvents;
  let fallbackFrame = 0;

  const pageCount = (doc) => Math.max(1, Math.trunc(Number(doc.pages) || 1));
  const clampPage = (value, total) =>
    Math.max(1, Math.min(Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : 1, total));
  const pageBlock = (page) => blocks[(page - 1) % blocks.length];

  function documentChooser(docs, selected) {
    return `<div data-active-scroll class="document-chooser" role="group" aria-label="문서 선택">${docs
      .map(
        (
          doc,
        ) => `<button type="button" class="document-choice" data-action="select-doc" data-id="${esc(doc.id)}" aria-pressed="${doc.id === selected.id}">
          <span class="document-choice-icon">${icon('FileText')}</span>
          <span class="document-choice-copy"><strong>${esc(doc.name)}</strong><small>${doc.sample ? `${pageCount(doc)}쪽 / 샘플` : '파일명만 등록'} / ${bytes(doc.size)}</small></span>
          ${doc.id === selected.id ? `<span class="document-choice-check">${icon('Check')}</span>` : ''}
        </button>`,
      )
      .join('')}</div>`;
  }

  function pageGallery(doc) {
    return `<p class="document-gallery-note">샘플 문서로 구성한 샘플 페이지입니다. 페이지를 선택하면 크게 읽을 수 있습니다.</p>
      <ol class="document-page-gallery" role="list" data-document-gallery data-document-id="${esc(doc.id)}">${Array.from(
        { length: pageCount(doc) },
        (
          _,
          index,
        ) => `<li class="document-page-card"><button type="button" class="document-page-open" data-action="open-doc-page" data-page="${index + 1}" aria-label="${index + 1}쪽 크게 보기" aria-haspopup="dialog">
          <span class="document-page-preview" data-page-preview="${index + 1}" data-preview-state="pending" aria-hidden="true">
            <span class="document-preview-placeholder">${icon('FileText')}<span>${index + 1}쪽 미리보기</span><span>크게 보기로 바로 열 수 있습니다</span></span>
          </span>
          <span class="document-page-caption"><strong>${index + 1}쪽</strong><span>샘플 페이지</span>${icon('ExternalLink')}</span>
        </button></li>`,
      ).join('')}</ol>`;
  }

  function registeredFile(doc) {
    return `<article class="document-registration">${icon('FileText')}<h3>${esc(doc.name)}</h3>
      <p>샘플 체험에서는 파일 이름만 표시합니다. 선택한 파일은 전송하지 않습니다.</p>
      <p class="quiet">샘플 문서를 선택하면 페이지 갤러리를 살펴볼 수 있습니다.</p>
      <span class="small quiet">${bytes(doc.size)} / 새로고침 시 등록 정보 초기화</span></article>`;
  }

  function documentWorkspace(docs, selected) {
    return `${documentChooser(docs, selected)}<section class="document-gallery-section">
      <header class="document-gallery-heading"><div><h2>${esc(selected.name)}</h2><p>${selected.sample ? `${pageCount(selected)}쪽 / 샘플 문서` : '목업에 등록한 파일'}</p></div>
        <div class="document-gallery-status">${docStatus(selected.status)}${selected.status === 'failed' ? button('다시 시도', 'retry-doc', 'RotateCcw', `data-id="${esc(selected.id)}"`) : ''}</div></header>
      ${selected.sample ? pageGallery(selected) : registeredFile(selected)}
    </section>`;
  }

  function viewDocuments() {
    const query = (ui.search.documents ?? '').toLowerCase();
    const docs = project().documents.filter((doc) => doc.name.toLowerCase().includes(query));
    const selected = docs.find((doc) => doc.id === ui.docId) ?? docs[0];
    if (selected) {
      ui.docId = selected.id;
      ui.page = clampPage(ui.page, pageCount(selected));
    }
    const body = selected
      ? documentWorkspace(docs, selected)
      : query
        ? empty('검색한 문서가 없습니다', '다른 파일명으로 검색해 주세요.', '', 'Search')
        : empty(
            '원본 문서를 추가하세요',
            '목업에서는 파일명과 크기를 등록하고 흐름을 확인합니다.',
            button('문서 추가', 'upload', 'Plus'),
          );
    return (
      pageHeading(
        '원본 문서',
        '문서를 골라 페이지와 내용을 살펴보세요.',
        `<button type="button" class="button primary" data-action="upload">${icon('Plus')}문서 추가</button>`,
      ) +
      `<div class="document-search-toolbar">${searchForm('documents')}<span class="quiet small">${docs.length}개 문서</span></div>` +
      `<div class="document-workspace">${body}</div>`
    );
  }

  function previewContents(page) {
    const block = pageBlock(page);
    return `<span class="document-preview-sheet"><span class="document-preview-label">샘플 ${page}쪽</span>
      <span class="document-preview-title">${esc(block.title)}</span><span class="document-preview-text">${esc(block.text)}</span>
      <span class="document-preview-subtitle">분석과 작성 방향</span><span class="document-preview-text">원본의 의미와 근거를 유지하면서 목차에 맞게 내용을 구성합니다.</span>
      <span class="document-preview-footer"><span>샘플 문서</span><span>${page}</span></span></span>`;
  }

  function hydratePreview(preview, root) {
    if (galleryRoot !== root || !root.isConnected || preview.dataset.previewState === 'ready')
      return;
    preview.innerHTML = previewContents(Number(preview.dataset.pagePreview));
    preview.dataset.previewState = 'ready';
  }

  function disposeDocumentGallery() {
    previewObserver?.disconnect();
    previewObserver = undefined;
    fallbackEvents?.abort();
    fallbackEvents = undefined;
    if (fallbackFrame) cancelAnimationFrame(fallbackFrame);
    fallbackFrame = 0;
    galleryRoot = undefined;
  }

  function enhanceDocumentGallery() {
    disposeDocumentGallery();
    const root = document.querySelector('[data-document-gallery]');
    if (!root) return;
    galleryRoot = root;
    const previews = [...root.querySelectorAll('[data-page-preview]')];
    if (typeof window.IntersectionObserver === 'function') {
      previewObserver = new IntersectionObserver(
        (entries, observer) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            hydratePreview(entry.target, root);
            observer.unobserve(entry.target);
          }
        },
        { rootMargin: '160px 0px', threshold: 0.01 },
      );
      previews.forEach((preview) => previewObserver.observe(preview));
      return;
    }
    // The fallback batches geometry reads and keeps every page button usable.
    const hydrateVisible = () => {
      fallbackFrame = 0;
      const nearby = previews
        .filter((preview) => preview.dataset.previewState === 'pending')
        .map((preview) => ({ preview, bounds: preview.getBoundingClientRect() }))
        .filter(({ bounds }) => bounds.top < window.innerHeight + 160 && bounds.bottom > -160);
      nearby.forEach(({ preview }) => hydratePreview(preview, root));
    };
    const schedule = () => {
      if (!fallbackFrame) fallbackFrame = requestAnimationFrame(hydrateVisible);
    };
    fallbackEvents = new AbortController();
    const options = { passive: true, signal: fallbackEvents.signal };
    window.addEventListener('scroll', schedule, { ...options, capture: true });
    window.addEventListener('resize', schedule, options);
    hydrateVisible();
  }

  function openDocumentPage(page) {
    const doc = project().documents.find((item) => item.id === ui.docId);
    if (!doc?.sample) return;
    const total = pageCount(doc);
    ui.page = clampPage(page, total);
    const block = pageBlock(ui.page);
    const wasOpen = context.dialog?.open;
    openDialog(
      `${doc.name} / ${ui.page}쪽`,
      `<div class="document-reader"><div class="document-reader-toolbar"><span class="quiet small">샘플 페이지 / ${ui.page} / ${total}</span><div class="row-controls">
        <button type="button" class="button" data-action="doc-prev" ${ui.page <= 1 ? 'disabled' : ''}>${icon('ChevronLeft')}이전 페이지</button>
        <button type="button" class="button" data-action="doc-next" ${ui.page >= total ? 'disabled' : ''}>다음 페이지${icon('ChevronRight')}</button></div></div>
        <article class="document-reading-page"><p class="document-reading-label">실제 파일을 대신하는 샘플 문서</p>
          <h3 data-document-page-title tabindex="-1">${esc(block.title)}</h3><p>${esc(block.text)}</p>
          <h4>분석과 작성 방향</h4><p>원본의 의미와 근거를 유지하면서 목차에 맞게 내용을 구성합니다. 결과를 검토한 뒤 프레젠테이션을 생성합니다.</p>
          <blockquote>자료를 읽고 발표에 필요한 내용을 골라 보세요.</blockquote>
          <footer><span>샘플 문서</span><span>${ui.page}쪽</span></footer>
        </article></div>`,
      true,
    );
    if (wasOpen)
      document.querySelector('[data-document-page-title]')?.focus({ preventScroll: true });
  }

  return { viewDocuments, enhanceDocumentGallery, disposeDocumentGallery, openDocumentPage };
};
