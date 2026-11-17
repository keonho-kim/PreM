// Purpose: Independently re-extract generated PPTX text using bundled Kordoc before publication.
// Pattern: Offline bounded source bytes, no OCR/models or arbitrary source rendering.
// Usage: Node receives the owned generation directory after the native exporter.
// Related: presentation-render.py, adapters/processes/presentations.rs.
import fs from 'node:fs/promises';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { parse } from './kordoc/node_modules/kordoc/dist/index.js';
new Worker(new URL('./process-parent-watch.mjs', import.meta.url), {
  workerData: { parent: process.ppid },
}).unref();
const [folder] = process.argv.slice(2);
const bytes = await fs.readFile(path.join(folder, 'output.pptx'));
if (bytes.length > 50 * 1024 * 1024) throw new Error('output_limit');
const specs = JSON.parse(await fs.readFile(path.join(folder, 'specs.json'), 'utf8'));
const references = JSON.parse(await fs.readFile(path.join(folder, 'references.json'), 'utf8'));
const fullReference = (spec) => {
  const object = (spec.objects ?? []).find(
    (o) =>
      o.content.kind === 'reference' &&
      ((o.frame.x === 0 && o.frame.y === 0 && o.frame.width === 100 && o.frame.height === 100) ||
        (spec.schema_version === 3 && !spec.block_ids.length)),
  );
  return (
    object &&
    references.find(
      (r) => r.id === object.content.reference_id && ['slide', 'page'].includes(r.kind),
    )
  );
};
const result = await parse(bytes, { images: false, ocr: false, tableFormat: 'gfm' });
if (!result.success) throw new Error('output_extraction_failed');
const pages = new Map();
function visit(block, inheritedPage) {
  const page = block.pageNumber ?? inheritedPage ?? (specs.length === 1 ? 1 : undefined);
  if (typeof block.text === 'string' && Number.isInteger(page)) {
    if (!pages.has(page)) pages.set(page, []);
    pages.get(page).push(block.text);
  }
  for (const child of block.children ?? []) visit(child, page);
}
for (const block of result.blocks ?? []) visit(block);
for (const [index, spec] of specs.entries()) {
  const compact = (pages.get(index + 1) ?? []).join('').replace(/\s/gu, '');
  const source = fullReference(spec);
  for (const text of [
    ...(!source || source.title !== spec.title ? [spec.title] : []),
    ...spec.bullets,
    ...(spec.objects ?? []).filter((o) => o.content.kind === 'text').map((o) => o.content.text),
  ])
    if (!compact.includes(text.replace(/\s/gu, ''))) throw new Error('output_text_missing');
}
await fs.writeFile(
  path.join(folder, 'validated.json'),
  JSON.stringify({ schema_version: 1, slides: specs.length }),
);
