// Purpose: Apply text formatting while preserving an active plain-text draft.
// Pattern: Small transaction adapter for built-in fields and inserted text boxes.
// Usage: Instantiated by canvas-editor.js for the current editable slide.
// Related: mock/js/ui.js, mock/js/slide-commands.js.
window.PuPuTyXModules.canvasFormat = ({ ui, deck, commands, sheet }) => {
  return function format(command, color) {
    const selected = ui.selectedObject,
      field = ui.selectedText ?? 'title';
    const slides = JSON.parse(JSON.stringify(deck().slides)),
      slide = slides[ui.slideIndex];
    const editing = sheet.querySelector('[contenteditable]:focus');
    if (editing) {
      const value = editing.innerText.slice(0, 2000);
      if (editing.dataset.editField === 'title') slide.title = value.slice(0, 100);
      else if (editing.dataset.editField !== undefined)
        slide.body[Number(editing.dataset.editField)] = value;
      else {
        const o = slide.objects?.find((o) => o.id === editing.dataset.objectText);
        if (o) o.text = value;
      }
    }
    let style;
    if (selected) {
      const o = slide.objects?.find((o) => o.id === selected);
      if (!o || o.type !== 'text') return;
      style = o;
    } else {
      slide.textStyles ??= {};
      slide.textStyles[field] ??= {};
      style = slide.textStyles[field];
    }
    const target = selected
      ? sheet.querySelector(`[data-object-text="${selected}"]`)
      : sheet.querySelector(`[data-edit-field="${field}"]`);
    const computed = target ? getComputedStyle(target) : null;
    if (command === 'bold')
      style.bold =
        style.bold === undefined ? Number(computed?.fontWeight ?? 400) < 600 : !style.bold;
    if (command === 'italic') style.italic = !style.italic;
    if (command === 'larger' || command === 'smaller')
      style.fontSize = Math.max(
        12,
        Math.min(
          96,
          (style.fontSize ?? parseFloat(computed?.fontSize ?? '24')) +
            (command === 'larger' ? 2 : -2),
        ),
      );
    if (command === 'color' && /^#[0-9a-f]{6}$/i.test(color)) style.color = color;
    if (command.startsWith('align-')) style.align = command.slice(6);
    slide.version++;
    commands.commit(slides, '텍스트 서식 변경');
  };
};
