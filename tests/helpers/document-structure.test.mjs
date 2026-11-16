// Purpose: Verify Kordoc structure adaptation preserves spans and unambiguous image identities.
// Pattern: Independent source cells with Unicode and nested tables; no document parser replacement.
// Usage: node --test tests/helpers/document-structure.test.mjs.
// Related: backend/tools/document-structure.mjs, parsing-quality corpus.
import test from 'node:test';
import assert from 'node:assert/strict';
import { imageIndex, tableContent } from '../../backend/tools/document-structure.mjs';
test('canonical text ranges retain Korean cells and nested spans without copying their bodies', () => {
  const nested = {
    rows: 1,
    cols: 2,
    cells: [[{ text: '중첩', colSpan: 2, rowSpan: 1 }, { text: '' }]],
  };
  const result = tableContent({
    rows: 2,
    cols: 2,
    hasHeader: true,
    cells: [
      [{ text: '한글 😀', colSpan: 2 }, { text: '' }],
      [{ text: '본문', blocks: [{ table: nested }] }, { text: '120' }],
    ],
  });
  assert.equal(result.text, '한글 😀 | \n본문 | 120');
  assert.equal(
    result.text.slice(result.metadata.table_cells[0].start, result.metadata.table_cells[0].end),
    '한글 😀',
  );
  assert.equal(result.metadata.table_cells[0].col_span, 2);
  assert.equal(result.metadata.nested_structure.cells[1][0].nested[0].cells[0][0].col_span, 2);
  assert.equal(JSON.stringify(result.metadata).includes('본문'), false);
});
test('separate Kordoc image arrays resolve by filename and reject ambiguous names', () => {
  const image = {
    filename: 'image_001.png',
    data: new Uint8Array([1, 2]),
    source: 'word/media/image1.png',
  };
  assert.equal(imageIndex([image]).get('image_001.png'), image);
  assert.throws(() => imageIndex([image, { ...image }]), /ambiguous/);
});
