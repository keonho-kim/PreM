// Purpose: Display complete extracted tables with preserved merged cells and safe canonical text.
// Pattern: shadcn semantic primitives; legacy or split/oversized tables retain their text fallback.
// Usage: ExtractedContent supplies one canonical block and its structure metadata.
// Related: backend/tools/document-structure.mjs, processing.css.
import { z } from 'zod';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
const schema = z.object({
  rows: z.number().int().min(1).max(100),
  cols: z.number().int().min(1).max(30),
  has_header: z.boolean(),
  part: z.literal(0),
  text_offset: z.literal(0),
  offset_unit: z.literal('utf16_code_units'),
  table_cells: z
    .array(
      z.object({
        row: z.number().int().nonnegative(),
        col: z.number().int().nonnegative(),
        start: z.number().int().nonnegative(),
        end: z.number().int().nonnegative(),
        row_span: z.number().int().positive(),
        col_span: z.number().int().positive(),
      }),
    )
    .max(3000),
});
export function ExtractedTable({
  text,
  attributes,
}: {
  text: string;
  attributes: Record<string, unknown>;
}) {
  const result = schema.safeParse(attributes);
  if (!result.success) return <pre>{text}</pre>;
  const data = result.data;
  if (
    data.table_cells.some(
      (c) =>
        c.row >= data.rows ||
        c.col >= data.cols ||
        c.start > c.end ||
        c.end > text.length ||
        c.row + c.row_span > data.rows ||
        c.col + c.col_span > data.cols,
    )
  )
    return <pre>{text}</pre>;
  const covered = new Set<string>();
  const coordinates = [...new Set(data.table_cells.map((cell) => cell.row))].sort((a, b) => a - b);
  if (coordinates.length !== data.rows) return <pre>{text}</pre>;
  const rows = coordinates.map((row) => (
    <TableRow key={row}>
      {data.table_cells
        .filter((c) => c.row === row)
        .map((c) => {
          if (covered.has(`${row}:${c.col}`)) return null;
          for (let r = row; r < row + c.row_span; r++)
            for (let col = c.col; col < c.col + c.col_span; col++)
              if (r !== row || col !== c.col) covered.add(`${r}:${col}`);
          const content = text.slice(c.start, c.end);
          return row === 0 && data.has_header ? (
            <TableHead
              key={c.col}
              scope={c.col_span > 1 ? 'colgroup' : 'col'}
              rowSpan={c.row_span}
              colSpan={c.col_span}
            >
              {content}
            </TableHead>
          ) : (
            <TableCell key={c.col} rowSpan={c.row_span} colSpan={c.col_span}>
              {content}
            </TableCell>
          );
        })}
    </TableRow>
  ));
  return (
    <Table className="extracted-table" aria-label="원문 표">
      <TableCaption>
        원문 표 · {data.rows}행 {data.cols}열
      </TableCaption>
      {data.has_header && <TableHeader>{rows[0]}</TableHeader>}
      <TableBody>{data.has_header ? rows.slice(1) : rows}</TableBody>
    </Table>
  );
}
