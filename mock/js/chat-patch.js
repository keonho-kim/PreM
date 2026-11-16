// Purpose: Simulate explicit component-scoped changes without claiming AI inference.
// Pattern: Pure allowlisted patch construction on cloned slide data.
// Usage: editor-chat.js pins its input revision and applies only a validated proposal.
// Related: editor-selection.js, slide-commands.js.
window.PuPuTyXModules.chatPatch = (slide, keys, instruction) => {
  const next = structuredClone(slide),
    changes = [];
  const quote = instruction.match(/["'‘“]([^"'’”]+)["'’”]/)?.[1];
  const targets = keys.length
    ? keys
    : /제목/.test(instruction) || quote
      ? ['field:title']
      : slide.body.map((_, i) => 'field:' + i);
  for (const key of targets) {
    const object = key.startsWith('object:')
      ? next.objects?.find((o) => o.id === key.slice(7))
      : null;
    const field = key.startsWith('field:') ? key.slice(6) : null;
    if (field === null && !object) continue;
    const text = object
      ? object.type === 'text'
        ? object.text
        : null
      : field === 'title'
        ? next.title
        : next.body[Number(field)];
    const before = JSON.stringify(object ?? { text, style: next.textStyles?.[field] });
    let value = text;
    if (text !== null && text !== undefined) {
      if (quote) value = quote.slice(0, field === 'title' ? 100 : 2000);
      else if (/짧게|요약|간결/.test(instruction))
        value = text.length > 24 ? text.slice(0, 24) + '…' : text;
      if (object) object.text = value;
      else if (field === 'title') next.title = value;
      else next.body[Number(field)] = value;
      if (/굵게|기울임/.test(instruction)) {
        const style = object ?? ((next.textStyles ??= {})[field] ??= {});
        if (/굵게/.test(instruction)) style.bold = true;
        if (/기울임/.test(instruction)) style.italic = true;
      }
    }
    if (object && /크게|작게/.test(instruction)) {
      const scale = /크게/.test(instruction) ? 1.1 : 0.9;
      object.w = Math.max(24, Math.min(960 - object.x, object.w * scale));
      object.h = Math.max(24, Math.min(540 - object.y, object.h * scale));
    }
    if (object && /오른쪽|왼쪽|위로|아래로/.test(instruction)) {
      object.x = Math.max(
        0,
        Math.min(
          960 - object.w,
          object.x + (/오른쪽/.test(instruction) ? 20 : /왼쪽/.test(instruction) ? -20 : 0),
        ),
      );
      object.y = Math.max(
        0,
        Math.min(
          540 - object.h,
          object.y + (/아래로/.test(instruction) ? 20 : /위로/.test(instruction) ? -20 : 0),
        ),
      );
    }
    const after = JSON.stringify(object ?? { text: value, style: next.textStyles?.[field] });
    if (before !== after)
      changes.push({
        key,
        before: text ?? '위치·크기',
        after:
          value !== text
            ? value
            : object && /크게|작게|오른쪽|왼쪽|위로|아래로/.test(instruction)
              ? `위치 ${Math.round(object.x)}, ${Math.round(object.y)} · 크기 ${Math.round(object.w)} × ${Math.round(object.h)}`
              : '텍스트 서식 변경',
      });
  }
  if (changes.length) next.version++;
  return { slide: next, changes, skipped: targets.length - changes.length };
};
