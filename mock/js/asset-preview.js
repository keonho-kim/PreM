// Purpose: Preview sample template slides and reference content without processing diagnostics.
// Pattern: Read-only sample view with local selection; the shared native dialog owns focus and dismissal.
// Usage: Space and Studio pass explicit asset metadata; uploads are never read or persisted.
// Related: space.js, ui.js, styles/asset-preview.css, mock/index.html.
window.PreMModules.assetPreview = (capabilities) => {
  'use strict';
  const { $, esc, icon, openDialog, renderSlide, fitSlides, templateLibrary } = capabilities;
  let current = null;
  const slides = (template) =>
    template.layouts.map((name, index) => ({
      title:
        index === 0 ? '다음 이야기를\n함께 만듭니다' : name === '목차' ? '오늘 나눌 이야기' : name,
      layout: index === 0 ? 'cover' : name === '프로세스' ? 'process' : 'cards',
      body:
        index === 0
          ? ['우리 팀의 방향과 계획을 소개합니다.']
          : ['방향을 정리합니다', '핵심 내용을 연결합니다', '다음 단계를 제안합니다'],
      version: 1,
    }));
  function paper(slide, index, theme) {
    return `<div aria-hidden="true">${renderSlide(slide, index, theme)}</div>`;
  }
  function openTemplate(item, uploaded = false) {
    const template = uploaded ? templateLibrary[0] : item;
    current = { slides: slides(template), theme: template.theme, selected: 0 };
    openDialog(
      item.name,
      `<section class="asset-preview" aria-label="템플릿 미리보기"><p class="asset-preview-caption">${uploaded ? '샘플 미리보기 · 업로드한 파일의 내용이 아닙니다.' : '템플릿 미리보기 · 샘플 디자인'}</p><div class="asset-preview-scroll"><div class="asset-preview-paper" data-preview-paper></div><div class="asset-preview-navigation"><button type="button" class="icon-button" data-action="preview-previous" aria-label="이전 슬라이드">${icon('ChevronLeft')}</button><p role="status" data-preview-position></p><button type="button" class="icon-button" data-action="preview-next" aria-label="다음 슬라이드">${icon('ChevronRight')}</button></div><fieldset class="asset-preview-thumbnails"><legend class="sr-only">슬라이드 목록</legend>${current.slides.map((slide, index) => `<button type="button" class="asset-preview-thumbnail" data-action="preview-slide" data-index="${index}" aria-label="슬라이드 ${index + 1} 보기" aria-pressed="${index === 0}">${paper(slide, index, current.theme)}<span>${index + 1}</span></button>`).join('')}</fieldset></div></section>`,
      true,
    );
    select(0);
  }
  function select(index) {
    if (
      !current ||
      !$('#app-dialog[open] .asset-preview') ||
      index < 0 ||
      index >= current.slides.length
    )
      return;
    current.selected = index;
    $('[data-preview-paper]').innerHTML = paper(current.slides[index], index, current.theme);
    $('[data-preview-paper]').setAttribute('aria-label', `슬라이드 ${index + 1} 미리보기`);
    $('[data-preview-paper]').setAttribute('role', 'img');
    $('[data-preview-position]').textContent = `${index + 1} / ${current.slides.length}`;
    $('[data-action="preview-previous"]').disabled = index === 0;
    $('[data-action="preview-next"]').disabled = index === current.slides.length - 1;
    for (const button of document.querySelectorAll('[data-action="preview-slide"]'))
      button.setAttribute('aria-pressed', String(Number(button.dataset.index) === index));
    fitSlides();
  }
  function openReference(item, uploaded = false) {
    current = null;
    openDialog(
      item.title ?? item.name,
      `<section class="asset-reference-preview"><p class="dialog-intro">${uploaded ? '선택한 파일의 내용은 읽지 않습니다.' : '참고 자료 · 샘플 자료'}</p>${uploaded ? '<p>이 목업에서는 파일 내용 미리보기를 제공하지 않습니다.</p>' : `<h3>${esc(item.title)}</h3><p>${esc(item.quote)}</p><p class="quiet">${esc(item.tag)} · ${Number(item.page)}페이지</p>`}</section>`,
    );
  }
  return {
    openTemplate,
    openReference,
    handlers: {
      'preview-slide': (target) => select(Number(target.dataset.index)),
      'preview-previous': () => current && select(current.selected - 1),
      'preview-next': () => current && select(current.selected + 1),
    },
  };
};
