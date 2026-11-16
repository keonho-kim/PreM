// Purpose: Verify quality metrics distinguish extraction failures from non-content metadata.
// Pattern: Small adversarial projections against hand-written expectations.
// Usage: node --test tests/helpers/parsing-checks.test.mjs.
// Related: parsing-checks.mjs, parsing-audit.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkExtraction } from './parsing-checks.mjs';
const detail = {
  pages: [
    { id: 'p1', source_page: 1 },
    { id: 'p2', source_page: 2 },
  ],
};
test('Korean OCR excludes image labels, retains punctuation and detects missing text', () => {
  const check = { type: 'ocr_cer', page: 2, reference: '처리 건수: 120건', maximum: 0.08 };
  const blocks = [
    { page_id: 'p1', kind: 'paragraph', text: '다른 페이지' },
    { page_id: 'p2', kind: 'paragraph', text: '처리건수:120건' },
    { page_id: 'p2', kind: 'image', text: 'image_001.png' },
  ];
  assert.equal(checkExtraction(check, detail, blocks, []).observed.cer, 0);
  blocks[1].text = '처리건수';
  assert.equal(checkExtraction(check, detail, blocks, []).pass, false);
});
test('all tokens present does not make an interleaved column order correct', () => {
  const blocks = [{ text: '왼쪽 첫째 오른쪽 첫째 왼쪽 둘째 오른쪽 둘째' }];
  const values = ['왼쪽 첫째', '왼쪽 둘째', '오른쪽 첫째', '오른쪽 둘째'];
  assert.equal(checkExtraction({ type: 'text', values }, detail, blocks, []).pass, true);
  assert.equal(checkExtraction({ type: 'order', values }, detail, blocks, []).pass, false);
});
test('plain table dimensions cannot substitute for preserved merge metadata', () => {
  const block = { kind: 'table', text: '결재 구분', attributes: { rows: 4, cols: 6 } };
  assert.equal(checkExtraction({ type: 'table_merges' }, detail, [block], []).pass, false);
  block.attributes.cells = [[{ colSpan: 2, rowSpan: 1 }]];
  assert.equal(checkExtraction({ type: 'table_merges' }, detail, [block], []).pass, true);
});
