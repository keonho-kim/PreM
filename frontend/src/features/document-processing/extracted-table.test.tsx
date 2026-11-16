// Purpose: Verify source-table semantics, merged cell occupancy and safe legacy fallback.
// Pattern: Actual shadcn table source with canonical text references.
// Usage: Vitest; browser verification covers scrolling and images.
// Related: extracted-table.tsx, backend/tools/document-structure.mjs.
import '@testing-library/jest-dom/vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { it, expect, afterEach } from 'vitest';
import { ExtractedTable } from './extracted-table';
afterEach(cleanup);
it('renders a real spanning header without duplicating covered cells or interpreting HTML', () => {
  const text = '<b>제목</b> | \nA | B';
  render(
    <ExtractedTable
      text={text}
      attributes={{
        rows: 2,
        cols: 2,
        has_header: true,
        part: 0,
        text_offset: 0,
        offset_unit: 'utf16_code_units',
        table_cells: [
          { row: 0, col: 0, start: 0, end: 9, row_span: 1, col_span: 2 },
          { row: 0, col: 1, start: 12, end: 12, row_span: 1, col_span: 1 },
          { row: 1, col: 0, start: 13, end: 14, row_span: 1, col_span: 1 },
          { row: 1, col: 1, start: 17, end: 18, row_span: 1, col_span: 1 },
        ],
      }}
    />,
  );
  expect(screen.getByRole('columnheader')).toHaveAttribute('colspan', '2');
  expect(screen.getAllByRole('cell')).toHaveLength(2);
  expect(screen.getByRole('region')).toHaveAttribute('tabindex', '0');
  expect(screen.getByRole('table').querySelector('b')).toBeNull();
});
it('retains text when legacy metadata or a split block cannot reproduce a complete table', () => {
  const { container } = render(
    <ExtractedTable text="원문 | 값" attributes={{ rows: 1, cols: 2 }} />,
  );
  expect(container.querySelector('table')).toBeNull();
  expect(container.querySelector('pre')).toHaveTextContent('원문 | 값');
});
