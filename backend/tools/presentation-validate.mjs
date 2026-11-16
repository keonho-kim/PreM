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
const result = await parse(bytes, { images: false, ocr: false, tableFormat: 'gfm' });
if (!result.success) throw new Error('output_extraction_failed');
const texts = [];
function visit(block) {
  if (typeof block.text === 'string') texts.push(block.text);
  for (const child of block.children ?? []) visit(child);
}
for (const block of result.blocks ?? []) visit(block);
const compact = texts.join('').replace(/\s/gu, '');
for (const spec of specs)
  for (const text of [spec.title, ...spec.bullets])
    if (!compact.includes(text.replace(/\s/gu, ''))) throw new Error('output_text_missing');
await fs.writeFile(
  path.join(folder, 'validated.json'),
  JSON.stringify({ schema_version: 1, slides: specs.length }),
);
