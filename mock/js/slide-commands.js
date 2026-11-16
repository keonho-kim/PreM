// Purpose: Own slide transactions, undo/redo and direct-edit commands.
// Pattern: Immutable slide snapshots with bounded per-deck interaction history.
// Usage: Composed once by app.js, shared by forms, menus and canvas adapters.
// Related: mock/js/slide-list.js, mock/js/canvas-editor.js, mock/app.js.
window.PuPuTyXModules.slideCommands = ({
  deck,
  ui,
  clone,
  uid,
  log,
  render,
  announce,
  readDraft,
  selectObject,
}) => {
  const histories = new WeakMap();
  const history = () => {
    const d = deck();
    if (!histories.has(d)) histories.set(d, { undo: [], redo: [] });
    return histories.get(d);
  };
  const capture = () => ({ slides: clone(deck().slides), index: ui.slideIndex });
  function applyDraft(slides) {
    const draft = readDraft?.();
    if (!draft) return;
    const slide = slides.find((s) => s.id === draft.slideId);
    if (!slide) return;
    if (draft.objectId) {
      const object = slide.objects?.find((o) => o.id === draft.objectId);
      if (!object || object.text === draft.text) return;
      object.text = draft.text;
    } else if (draft.field === 'title') {
      if (slide.title === draft.text) return;
      slide.title = draft.text;
    } else {
      const index = Number(draft.field);
      if (slide.body[index] === draft.text) return;
      slide.body[index] = draft.text;
    }
    const old = deck().slides.find((s) => s.id === slide.id);
    if (old) slide.version = Math.max(slide.version, old.version + 1);
  }
  function editableSlides() {
    const slides = clone(deck().slides);
    applyDraft(slides);
    return slides;
  }
  function publish(slides, title) {
    const d = deck();
    d.version++;
    d.slides = slides;
    ui.slideIndex = Math.max(0, Math.min(ui.slideIndex, slides.length - 1));
    d.revisions.push({ version: d.version, at: new Date().toISOString(), slides: clone(slides) });
    log(title, `${d.title} / 버전 v${d.version}`);
    render();
    announce(title);
  }
  function commit(slides, title, nextIndex = ui.slideIndex) {
    applyDraft(slides);
    const h = history();
    h.undo.push(capture());
    if (h.undo.length > 20) h.undo.shift();
    h.redo = [];
    ui.slideIndex = nextIndex;
    publish(slides, title);
  }
  function travel(from, to, label) {
    const h = history();
    if (!h[from].length) return;
    const target = h[from].pop();
    h[to].push(capture());
    ui.slideIndex = target.index;
    publish(clone(target.slides), label);
  }
  function insert(at = ui.slideIndex + 1) {
    const slides = editableSlides();
    at = Math.max(0, Math.min(slides.length, at));
    slides.splice(at, 0, {
      id: uid(),
      version: 1,
      title: '새 슬라이드',
      layout: 'content',
      body: ['전달할 핵심 메시지를 입력하세요.'],
      evidence: [],
      objects: [],
    });
    commit(slides, '슬라이드 추가', at);
    focusSlide();
  }
  function duplicate(index = ui.slideIndex) {
    const slides = editableSlides();
    slides.splice(index + 1, 0, { ...clone(slides[index]), id: uid(), version: 1 });
    commit(slides, '슬라이드 복제', index + 1);
    focusSlide();
  }
  function remove(index = ui.slideIndex) {
    if (deck().slides.length <= 1) return;
    const slides = editableSlides();
    const selected = slides[ui.slideIndex].id;
    slides.splice(index, 1);
    const next = slides.findIndex((s) => s.id === selected);
    commit(slides, '슬라이드 삭제', next >= 0 ? next : Math.min(index, slides.length - 1));
    focusSlide();
  }
  function move(from, to) {
    const slides = editableSlides();
    to = Math.max(0, Math.min(slides.length, to));
    if (from === to || from + 1 === to) return;
    const active = slides[from].id;
    const [slide] = slides.splice(from, 1);
    slides.splice(to > from ? to - 1 : to, 0, slide);
    commit(
      slides,
      '슬라이드 순서 변경',
      slides.findIndex((s) => s.id === active),
    );
    focusSlide();
  }
  function focusSlide() {
    document
      .querySelector(`.slide-thumb[data-index="${ui.slideIndex}"]`)
      ?.focus({ preventScroll: true });
  }
  function change(operation, title) {
    const slides = editableSlides(),
      slide = slides[ui.slideIndex];
    operation(slide);
    slide.version = deck().slides.find((item) => item.id === slide.id).version + 1;
    commit(slides, title);
  }
  function text(field, value) {
    value = value.slice(0, field === 'title' ? 100 : 2000);
    const old =
      field === 'title'
        ? deck().slides[ui.slideIndex].title
        : deck().slides[ui.slideIndex].body[Number(field)];
    if (old === value) return;
    change((s) => {
      if (field === 'title') s.title = value;
      else s.body[Number(field)] = value;
    }, '텍스트 직접 수정');
  }
  function object(id, patch) {
    change((s) => {
      const o = s.objects?.find((x) => x.id === id);
      if (o) Object.assign(o, patch);
    }, '요소 수정');
  }
  function addObject(value) {
    const id = uid();
    ui.selectedObject = id;
    change((s) => {
      s.objects ??= [];
      s.objects.push({ id, x: 120, y: 120, w: 320, h: 180, ...value });
    }, '요소 삽입');
    selectObject(id);
  }
  function removeObject() {
    const id = ui.selectedObject;
    if (!id) return;
    ui.selectedObject = null;
    change((s) => {
      s.objects = (s.objects ?? []).filter((o) => o.id !== id);
    }, '요소 삭제');
    selectObject(null);
  }
  return {
    commit,
    insert,
    duplicate,
    remove,
    move,
    text,
    object,
    addObject,
    removeObject,
    undo: () => travel('undo', 'redo', '실행 취소'),
    redo: () => travel('redo', 'undo', '다시 실행'),
    canUndo: () => !!deck() && history().undo.length > 0,
    canRedo: () => !!deck() && history().redo.length > 0,
  };
};
