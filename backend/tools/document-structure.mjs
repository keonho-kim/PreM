// Purpose: Preserve Kordoc table spans and resolve its separate image array without parsing formats.
// Pattern: Canonical cell text once; structure uses offsets, spans and nested metadata only.
// Usage: document-extract.mjs bundles this helper with the pinned runtime profile.
// Related: tests/helpers/document-structure.test.mjs, document-processing/extracted-table.tsx.
export function imageIndex(images = []) {
  const map = new Map();
  for (const image of images) {
    if (map.has(image.filename)) throw new Error('ambiguous_image_reference');
    map.set(image.filename, image);
  }
  return map;
}
function spans(table, depth = 0) {
  if (depth > 32) throw new Error('table_depth_limit');
  return {
    rows: table.rows,
    cols: table.cols,
    cells: table.cells.map((row) =>
      row.map((cell) => ({
        row_span: cell.rowSpan ?? 1,
        col_span: cell.colSpan ?? 1,
        nested: (cell.blocks ?? [])
          .filter((block) => block.table)
          .map((block) => spans(block.table, depth + 1)),
      })),
    ),
  };
}
export function tableContent(table) {
  let text = '';
  const cells = [];
  for (const [row, values] of table.cells.entries()) {
    if (row) text += '\n';
    for (const [col, cell] of values.entries()) {
      if (col) text += ' | ';
      const start = text.length;
      text += cell.text ?? '';
      cells.push({
        row,
        col,
        start,
        end: text.length,
        row_span: cell.rowSpan ?? 1,
        col_span: cell.colSpan ?? 1,
      });
    }
  }
  return {
    text,
    metadata: {
      rows: table.rows,
      cols: table.cols,
      has_header: table.hasHeader === true,
      table_cells: cells,
      nested_structure: spans(table),
      offset_unit: 'utf16_code_units',
    },
  };
}
