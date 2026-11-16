// Purpose: Compare extraction projections against independently authored corpus expectations.
// Pattern: Deterministic comparisons; a finding remains a failure instead of becoming a baseline.
// Usage: parsing-audit.mjs passes pages, blocks and reusable materials from real product APIs.
// Related: tests/fixtures/parsing-quality/expectations.json.
const normalize = (text) => text.normalize('NFC').replace(/\s+/gu, '');
function distance(left, right) {
  const a = [...left],
    b = [...right];
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < b.length; j++)
      next.push(Math.min(next[j] + 1, row[j + 1] + 1, row[j] + (a[i] === b[j] ? 0 : 1)));
    row = next;
  }
  return row[b.length];
}
function hasSpan(value) {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(
    ([key, val]) =>
      (/^(row_?span|col_?span)$/i.test(key) && typeof val === 'number' && val > 1) || hasSpan(val),
  );
}
export function checkExtraction(check, detail, blocks, materials) {
  const selected = check.page
    ? blocks.filter(
        (block) =>
          detail.pages.find((page) => page.id === block.page_id)?.source_page === check.page,
      )
    : blocks;
  const text = normalize(selected.map((block) => block.text).join('\n'));
  let pass = false,
    observed;
  switch (check.type) {
    case 'text':
    case 'page_text':
      observed = { missing: check.values.filter((value) => !text.includes(normalize(value))) };
      pass = observed.missing.length === 0;
      break;
    case 'order': {
      const positions = check.values.map((value) => text.indexOf(normalize(value)));
      observed = { positions };
      pass = positions.every((position, i) => position >= 0 && (!i || position > positions[i - 1]));
      break;
    }
    case 'images':
      observed = { count: blocks.filter((block) => block.image).length };
      pass = observed.count >= check.minimum;
      break;
    case 'previews':
      observed = { count: detail.pages.filter((page) => page.preview).length };
      pass = observed.count >= check.minimum;
      break;
    case 'table_shape':
      observed = {
        shapes: blocks
          .filter((b) => b.kind === 'table')
          .map((b) => ({ rows: b.attributes.rows, cols: b.attributes.cols })),
      };
      pass = observed.shapes.some((s) => s.rows === check.rows && s.cols === check.cols);
      break;
    case 'table_merges':
      pass = blocks.some((block) => hasSpan(block.attributes));
      observed = { machine_readable_spans: pass };
      break;
    case 'formula':
      pass = blocks.some((block) => JSON.stringify(block.attributes).includes(check.value));
      observed = { formula_in_attributes: pass };
      break;
    case 'materials':
      observed = { kinds: [...new Set(materials.map((item) => item.kind))] };
      pass = check.kinds.every((kind) => observed.kinds.includes(kind));
      break;
    case 'ocr_cer': {
      const reference = normalize(check.reference);
      // Image placeholders such as image_001.png are metadata, not OCR transcript characters.
      const transcript = normalize(
        selected
          .filter((block) => block.kind !== 'image')
          .map((block) => block.text)
          .join('\n'),
      );
      const characters = [...reference].length;
      const edits = distance(reference, transcript);
      observed = {
        characters,
        edits,
        cer: edits / characters,
        normalization: 'NFC; whitespace removed; punctuation retained',
      };
      pass = observed.cer <= check.maximum;
      break;
    }
    default:
      throw new Error(`Unknown corpus check: ${check.type}`);
  }
  return { ...check, pass, observed };
}
