// Purpose: Show visual file/content search results and pin reusable PPT source objects.
// Pattern: Sample search read model with explicit selection commands and immutable source IDs.
// Usage: Composed by the content feature; file previews never read selected user files.
// Related: mock/js/views/content.js, mock/js/workflow.js, mock/styles/asset-search.css.
window.PreMModules.assetSearch = (c) => {
  const {
    esc,
    icon,
    project,
    ui,
    referenceLibrary,
    templateLibrary,
    pageHeading,
    searchForm,
    renderSlide,
    openDialog,
    render,
    announce,
  } = c;
  const source = '참고 프레젠테이션.pptx';
  const parts = [
    {
      id: 'ppt-image-2',
      kind: 'image',
      title: '원본에서 발표까지',
      page: 2,
      description: '작업 흐름 도식 이미지',
      mode: '이미지 삽입',
    },
    {
      id: 'ppt-chart-3',
      kind: 'chart',
      title: '샘플 프로젝트 구성',
      page: 3,
      description: '원본·목차·슬라이드 수를 비교하는 차트',
      mode: '차트 삽입',
    },
    {
      id: 'ppt-slide-1',
      kind: 'slide',
      title: '근거가 이어지는 문서의 다음 장',
      page: 1,
      description: '표지 장표 전체를 재사용',
      mode: '장표 전체 삽입',
    },
  ].map((item) => ({ ...item, source, version: 1, fileId: 'sample-ppt', sample: true }));
  const files = referenceLibrary.map((ref) => ({
    id: ref.id,
    kind: 'file',
    title: ref.title,
    source: ref.title + '.pdf',
    version: ref.version,
    page: ref.page,
    description: ref.quote,
    mode: '파일 근거로 사용',
  }));
  const text = referenceLibrary.map((ref) => ({
    ...files.find((item) => item.id === ref.id),
    id: ref.id + '-text',
    kind: 'text',
    parentId: ref.id,
    mode: '이 문단을 근거로 사용',
  }));
  const catalog = [
    ...files,
    {
      id: 'ppt-file',
      kind: 'file',
      title: source,
      source,
      version: 1,
      description: '이미지·차트·장표를 포함한 샘플 PPT',
      mode: '파일 근거로 사용',
    },
    ...text,
    ...parts,
  ];
  const labels = { file: '파일', text: '문단', image: '이미지', chart: '차트', slide: '장표 전체' };
  function preview(item) {
    if (item.kind === 'image')
      return `<div class="asset-flow" aria-label="샘플 작업 흐름 이미지"><span>원본 문서</span>${icon('ChevronRight')}<span>근거 연결</span>${icon('ChevronRight')}<span>프레젠테이션</span></div>`;
    if (item.kind === 'chart')
      return `<div class="asset-chart" aria-label="샘플 데이터: 원본 3, 목차 5, 슬라이드 6"><strong>샘플 프로젝트 구성</strong><div>${[
        ['원본', 3],
        ['목차', 5],
        ['슬라이드', 6],
      ]
        .map(([label, n]) => `<span><i style="--bar:${n / 6}"></i><b>${n}</b>${label}</span>`)
        .join('')}</div></div>`;
    if (item.kind === 'slide' || item.id === 'ppt-file')
      return renderSlide(
        {
          layout: 'cover',
          title: '근거가 이어지는\n문서의 다음 장',
          body: ['원본 문서의 근거를 프레젠테이션으로.'],
        },
        0,
      );
    return `<div class="asset-paper"><span>${item.kind === 'file' ? '문서 표지' : '원문 발췌'}</span><strong>${esc(item.title)}</strong><p>${esc(item.description)}</p><small>${item.page}쪽 / 샘플 문서</small></div>`;
  }
  function selected(item) {
    return item.kind === 'file' && referenceLibrary.some((ref) => ref.id === item.id)
      ? project().selectedRefs.includes(item.id)
      : (project().selectedInsertions ?? []).some((part) => part.id === item.id);
  }
  function resultRow(item, query) {
    const matched = query && item.description.toLowerCase().includes(query);
    return `<article class="search-result-row"><button type="button" class="asset-visual" data-action="preview-asset" data-id="${item.id}" aria-label="${esc(item.title)} 크게 보기">${preview(item)}</button><div class="search-result-copy"><p class="quiet small" data-search-match>${labels[item.kind]} / ${esc(item.source)} / v${item.version}${item.page ? ` / ${item.page}쪽` : ''}</p><h2 data-search-match>${esc(item.title)}</h2><p class="search-excerpt" data-search-match>${esc(item.description)}</p><p class="quiet small">${query ? (matched ? '본문에 검색어가 포함됩니다' : '제목 또는 파일명에 검색어가 포함됩니다') : '함께 사용할 수 있는 샘플 자료'}</p><label class="asset-choice"><input type="checkbox" data-asset-choice="${item.id}" ${selected(item) ? 'checked' : ''} />${selected(item) ? '생성 자료에 담김' : item.mode}</label></div></article>`;
  }
  function pageReferences(slide) {
    const relations = {
      r1: ['b1', 'b5'],
      r2: ['b2', 'b3'],
      r3: ['b4'],
      'ppt-image-2': ['b2', 'b4'],
      'ppt-chart-3': ['b1', 'b5'],
      'ppt-slide-1': ['b1'],
    };
    const items = catalog.filter((item) =>
      (relations[item.parentId ?? item.id] ?? []).some((id) => slide.evidence.includes(id)),
    );
    const kinds = ['image', 'chart', 'slide', 'text', 'file'];
    items.sort((a, b) => kinds.indexOf(a.kind) - kinds.indexOf(b.kind));
    const pinned = slide.sourceInsertions ?? [];
    return `<p class="quiet small">이 슬라이드와 관련된 샘플 자료 ${items.length}개</p><div class="page-reference-gallery">${items.map((item) => `<article class="asset-result"><button type="button" class="asset-visual" data-action="preview-asset" data-id="${item.id}" aria-label="${esc(item.title)} 크게 보기">${preview(item)}</button><h3>${esc(item.title)}</h3><p>${labels[item.kind]} / ${esc(item.source)} / ${item.page ?? 1}쪽 / v${item.version}</p><button type="button" class="button" data-action="attach-page-reference" data-id="${item.id}" aria-pressed="${pinned.some((x) => x.id === item.id)}">${pinned.some((x) => x.id === item.id) ? '이 슬라이드에서 제외' : '이 슬라이드에 사용'}</button></article>`).join('') || '<p>연결된 후보가 없습니다. 원문 근거를 연결하거나 근거 검색에서 자료를 확인하세요.</p>'}</div><a class="button quiet-button" href="${c.href('references')}">전체 근거 검색</a><p class="quiet small">샘플 자료입니다. 선택한 내용은 이 슬라이드의 참고 자료에 담깁니다.</p>`;
  }
  function references() {
    const q = (ui.search.references ?? '').trim().toLowerCase(),
      type = ui.assetKind ?? 'all';
    const found = catalog.filter(
      (item) =>
        (type === 'all' || item.kind === type) &&
        `${item.title} ${item.source} ${item.description}`.toLowerCase().includes(q),
    );
    const order = ['image', 'chart', 'slide', 'file', 'text'];
    found.sort(
      (a, b) =>
        Number(b.description.toLowerCase().includes(q)) -
          Number(a.description.toLowerCase().includes(q)) ||
        order.indexOf(a.kind) - order.indexOf(b.kind),
    );
    const selectedItems = catalog.filter(selected);
    return (
      pageHeading('참고 자료 찾기', '검색한 자료를 살펴보고 PPT에 쓸 내용을 담으세요.') +
      `<div class="toolbar">${searchForm('references')}<a class="button quiet-button" href="${c.href('space')}">Space에서 자료 관리</a></div><div class="asset-filters" aria-label="검색 결과 유형">${[['all', '전체'], ...Object.entries(labels)].map(([id, label]) => `<button type="button" class="button quiet-button" data-action="asset-filter" data-kind="${id}" aria-pressed="${type === id}">${label}</button>`).join('')}</div><p class="quiet small">${found.length}개 결과 / 파일 이름과 내용에서 찾았습니다 · 샘플 자료</p>` +
      `<div class="search-results">${found.length ? found.map((item) => resultRow(item, q)).join('') : '<p>일치하는 자료가 없습니다. 검색어나 유형을 바꿔 보세요.</p>'}</div><section class="asset-basket" aria-label="생성에 사용할 자료"><h2>생성에 사용할 자료 ${selectedItems.length}개</h2><p>선택한 자료를 확인하세요.</p><div>${selectedItems.map((item) => `<button type="button" class="button" data-action="preview-asset" data-id="${item.id}">${labels[item.kind]}: ${esc(item.title)}</button>`).join('') || '선택한 자료가 없습니다.'}</div></section><p class="quiet small">미리보기는 샘플입니다. 선택한 자료를 실제 파일에 넣지는 않습니다.</p>`
    );
  }
  function choose(input) {
    const item = catalog.find((item) => item.id === input.dataset.assetChoice);
    if (!item) return;
    const p = project();
    if (item.kind === 'file' && referenceLibrary.some((ref) => ref.id === item.id))
      p.selectedRefs = input.checked
        ? [...new Set([...p.selectedRefs, item.id])]
        : p.selectedRefs.filter((id) => id !== item.id);
    else {
      p.selectedInsertions ??= [];
      p.selectedInsertions = p.selectedInsertions.filter((part) => part.id !== item.id);
      if (input.checked)
        p.selectedInsertions.push({
          id: item.id,
          fileId: item.fileId ?? item.parentId ?? item.id,
          source: item.source,
          version: item.version,
          page: item.page ?? null,
          kind: item.kind,
          title: item.title,
          mode: item.mode,
        });
    }
    announce('생성에 사용할 자료를 변경했습니다.');
    // Keep the checkbox node and focus stable while its selection changes.
    const position = [...document.querySelectorAll('[data-asset-choice]')].indexOf(input);
    render();
    document.querySelectorAll('[data-asset-choice]')[position]?.focus({ preventScroll: true });
  }
  function templates() {
    const q = (ui.search.templates ?? '').trim().toLowerCase();
    const found = templateLibrary.filter((t) =>
      `${t.name} ${t.note} ${t.layouts.join(' ')}`.toLowerCase().includes(q),
    );
    return (
      pageHeading('템플릿 찾기', '미리보기를 보고 발표에 어울리는 디자인을 고르세요.') +
      searchForm('templates') +
      `<div class="asset-gallery">${found.map((t) => `<article class="asset-result"><button type="button" class="asset-visual" data-action="template-layouts" data-id="${t.id}" aria-label="${esc(t.name)} 미리보기"><div class="slide-fit" data-slide-fit><div class="template-sample ${t.theme}" aria-hidden="true"><span>PreM</span><strong>근거가 이어지는<br />문서의 다음 장</strong></div></div></button><h2>${esc(t.name)}</h2><p>${esc(t.note)}</p><p>${t.layouts.length}장 · 샘플 디자인</p><button type="button" class="button" data-action="select-template" data-id="${t.id}" aria-pressed="${project().template === t.id}">${project().template === t.id ? '선택됨' : '이 디자인 사용'}</button></article>`).join('') || '<p>일치하는 디자인이 없습니다.</p>'}</div>`
    );
  }
  const handlers = {
    'attach-page-reference': (target) => {
      const item = catalog.find((item) => item.id === target.dataset.id);
      if (!item) return;
      const slides = c.clone(c.deck().slides),
        slide = slides[ui.slideIndex];
      const old = slide.sourceInsertions ?? [];
      slide.sourceInsertions = old.some((x) => x.id === item.id)
        ? old.filter((x) => x.id !== item.id)
        : [
            ...old,
            {
              id: item.id,
              kind: item.kind,
              source: item.source,
              version: item.version,
              page: item.page ?? null,
              mode: item.mode,
              title: item.title,
            },
          ];
      slide.version += 1;
      c.commitSlides(slides, '현재 슬라이드 Reference 변경');
    },
    'asset-filter': (target) => {
      ui.assetKind = target.dataset.kind;
      render();
    },
    'preview-asset': (target) => {
      const item = catalog.find((item) => item.id === target.dataset.id);
      if (!item) return;
      openDialog(
        item.title,
        `<div class="asset-large">${preview(item)}</div><p class="task-notice">${esc(item.source)} / v${item.version}${item.page ? ` / ${item.page}쪽` : ''}</p><p>${labels[item.kind]}: ${item.mode}. 샘플 미리보기입니다.</p>`,
        true,
      );
    },
  };
  return { references, templates, choose, handlers, pageReferences };
};
