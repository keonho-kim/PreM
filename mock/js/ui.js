// Purpose: Render shared UI states, slide previews, and form primitives.
// Pattern: Feature factory with an explicit application context.
// Usage: Registered before mock/app.js by mock/index.html.
// Related: mock/app.js, mock/index.html.
window.PuPuTyXModules.ui = (context) => {
  'use strict';
  const { $, $$, esc, icon, button, formatDate, ui } = context;
  let resizeObserver;
  function pageHeading(title, description = '', actions = '') {
    return `<div class="page-heading"><div><h1 id="main-title" tabindex="-1">${esc(title)}</h1>${description ? `<p>${esc(description)}</p>` : ''}</div>${actions ? `<div class="heading-actions">${actions}</div>` : ''}</div>`;
  }

  function empty(title, description, action = '', symbol = 'FolderOpen') {
    return `<div class="empty-state">${icon(symbol)}<h2>${esc(title)}</h2><p>${esc(description)}</p>${action}</div>`;
  }

  function searchForm(view, extra = '') {
    return `<search><form class="search-form" data-form="search" method="get" action="#"><div class="field"><label for="search-input">${view === 'projects' ? '프로젝트 이름 검색' : ['references', 'templates'].includes(view) ? '파일명 또는 내용 검색' : '파일명 검색'}</label><input type="search" id="search-input" name="q" maxlength="120" value="${esc(ui.search[view] ?? '')}" autocomplete="off" /></div>${extra}<button class="button" type="submit">${icon('Search')}검색</button></form></search>`;
  }

  function renderSlide(slide, index = 0, theme = '') {
    const textStyle = (key) => {
      const s = slide.textStyles?.[key] ?? {};
      return `${s.fontSize ? 'font-size:' + Math.max(12, Math.min(96, s.fontSize)) + 'px;' : ''}${s.bold !== undefined ? 'font-weight:' + (s.bold ? 600 : 400) + ';' : ''}${s.italic ? 'font-style:italic;' : ''}${/^#[0-9a-f]{6}$/i.test(s.color ?? '') ? 'color:' + s.color + ';' : ''}${['left', 'center', 'right'].includes(s.align) ? 'text-align:' + s.align + ';' : ''}`;
    };
    const styleAttr = (key) => (slide.textStyles?.[key] ? ` style="${textStyle(key)}"` : '');
    const objects = (slide.objects ?? [])
      .map(
        (o) =>
          `<div class="slide-object" data-object-id="${esc(o.id)}" style="left:${Number(o.x) || 0}px;top:${Number(o.y) || 0}px;width:${Number(o.w) || 100}px;height:${Number(o.h) || 80}px">${o.type === 'shape' ? '<div class="canvas-shape"></div>' : o.type === 'image' && /^data:image\/(png|jpeg|webp);base64,/.test(o.src) ? `<img src="${esc(o.src)}" alt="${esc(o.alt)}" draggable="false" />` : `<div data-object-text="${esc(o.id)}" style="${/^#[0-9a-f]{6}$/i.test(o.color ?? '') ? 'color:' + o.color + ';' : ''}font-size:${Math.max(12, Math.min(96, o.fontSize ?? 28))}px;font-weight:${o.bold ? 600 : 400};font-style:${o.italic ? 'italic' : 'normal'};text-align:${['left', 'center', 'right'].includes(o.align) ? o.align : 'left'}">${esc(o.text ?? '')}</div>`}<span data-object-move aria-hidden="true">${icon('GripVertical')}</span><span data-object-resize aria-hidden="true"></span></div>`,
      )
      .join('');
    return `<div class="slide-fit" data-slide-fit><article data-slide-id="${esc(slide.id ?? '')}" class="slide-sheet ${slide.layout === 'cover' ? 'cover' : ''} ${theme}" aria-label="슬라이드 미리보기"><div class="slide-brand">PuPuTyX</div><h2 data-edit-field="title"${styleAttr('title')}>${esc(slide.title)}</h2>${
      slide.layout === 'cover'
        ? `<p data-edit-field="0"${styleAttr(0)}>${esc(slide.body[0] ?? '')}</p>`
        : slide.layout === 'process'
          ? `<div class="slide-process">${slide.body
              .slice(0, 3)
              .map(
                (item, i) =>
                  `<div><strong>${String(i + 1).padStart(2, '0')}</strong><span data-edit-field="${i}"${styleAttr(i)}>${esc(item)}</span></div>`,
              )
              .join('')}</div>`
          : `<ul>${slide.body.map((item, i) => `<li data-edit-field="${i}"${styleAttr(i)}>${esc(item)}</li>`).join('')}</ul>`
    }${objects}<div class="slide-foot"><span>샘플 프레젠테이션</span><span>${String(index + 1).padStart(2, '0')}</span></div></article></div>`;
  }

  function fitSlides() {
    resizeObserver?.disconnect();
    resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries)
        entry.target.style.setProperty('--slide-scale', String(entry.contentRect.width / 960));
    });
    $$('[data-slide-fit]').forEach((node) => {
      node.style.setProperty('--slide-scale', String(node.clientWidth / 960));
      resizeObserver.observe(node);
    });
  }

  function activityList(items) {
    return items.length
      ? `<ul class="activity-list">${items.map((item) => `<li><span class="activity-main"><span>${esc(item.title)}</span><span class="quiet">${esc(item.description)}</span></span><time datetime="${item.at}">${formatDate(item.at)}</time></li>`).join('')}</ul>`
      : '<p class="quiet">작업을 시작하면 이곳에 이력이 표시됩니다.</p>';
  }
  function enhanceTables() {
    $$('.table-scroll').forEach((region, index) => {
      const caption = $('caption', region);
      if (!caption) return;
      caption.id = `table-${ui.view}-${index}`;
      region.setAttribute('role', 'region');
      region.setAttribute('aria-labelledby', caption.id);
      region.tabIndex = 0;
      $$('tbody tr', region).forEach((row) => {
        const first = row.cells[0];
        if (!first || first.tagName === 'TH') return;
        const heading = document.createElement('th');
        heading.scope = 'row';
        heading.innerHTML = first.innerHTML;
        first.replaceWith(heading);
      });
    });
  }
  const disposeSlides = () => resizeObserver?.disconnect();
  return {
    enhanceTables,
    disposeSlides,
    pageHeading,
    empty,
    searchForm,
    renderSlide,
    fitSlides,
    activityList,
  };
};
