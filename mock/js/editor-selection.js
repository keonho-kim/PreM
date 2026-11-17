// Purpose: Own the current slide's component selection and canvas affordances.
// Pattern: Session-only stable field/object keys with a narrow change subscription.
// Usage: Composed once; canvas and chat share this selection owner.
// Related: canvas-editor.js, canvas-text.js, editor-chat.js.
window.PreMModules.editorSelection = ({ ui, deck }) => {
  let owner,
    slideId,
    keys = [],
    changed = () => {};
  const current = () => deck()?.slides[ui.slideIndex];
  function read() {
    const slide = current();
    if (owner !== deck() || slideId !== slide?.id) {
      owner = deck();
      slideId = slide?.id;
      keys = [];
      ui.selectedObject = null;
      ui.selectedText = null;
    }
    keys = keys.filter((key) =>
      key.startsWith('object:')
        ? slide.objects?.some((o) => 'object:' + o.id === key)
        : key === 'field:title' || slide.body[Number(key.slice(6))] !== undefined,
    );
    return [...keys];
  }
  function label(key) {
    if (key === 'field:title') return '제목';
    if (key.startsWith('field:')) return '본문 ' + (Number(key.slice(6)) + 1);
    const object = current()?.objects?.find((o) => 'object:' + o.id === key);
    return object?.type === 'image' ? '이미지' : object?.type === 'shape' ? '도형' : '텍스트 상자';
  }
  function paint() {
    const selected = read();
    document
      .querySelectorAll('.editor-stage [data-edit-field], .editor-stage [data-object-id]')
      .forEach((node) => {
        const key = node.dataset.objectId
          ? 'object:' + node.dataset.objectId
          : 'field:' + node.dataset.editField;
        node.classList.toggle('component-selected', selected.includes(key));
        if (node.dataset.objectId) node.classList.toggle('is-selected', selected.includes(key));
      });
  }
  function choose(key, toggle = false) {
    read();
    keys =
      key === null
        ? []
        : toggle
          ? keys.includes(key)
            ? keys.filter((k) => k !== key)
            : [...keys, key]
          : [key];
    const last = keys.at(-1);
    ui.selectedObject = last?.startsWith('object:') ? last.slice(7) : null;
    ui.selectedText = last?.startsWith('field:') ? last.slice(6) : null;
    paint();
    changed();
  }
  return {
    read,
    label,
    paint,
    choose,
    onChange: (handler) => {
      changed = handler;
    },
  };
};
