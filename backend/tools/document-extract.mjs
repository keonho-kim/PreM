// Purpose: Extract local reference documents into bounded, versioned content blocks and PNG assets.
// Pattern: Kordoc owns format parsing/OCR; PDFium/Sharp produce passive previews, never HTML execution.
// Usage: Bundled Node invokes this with input path and output directory under one owned workspace.
// Related: scripts/prepare-document-runtime.mjs, adapters/processes/documents.rs.
import fs from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
const parentWatch = new Worker(new URL('./process-parent-watch.mjs', import.meta.url), {
  workerData: { parent: process.ppid },
});
parentWatch.unref();
import path from 'node:path';
import { imageIndex, tableContent } from './document-structure.mjs';
import { createHash } from 'node:crypto';
import { parse, renderDocument } from './kordoc/node_modules/kordoc/dist/index.js';
import { createRequire } from 'node:module';
const require = createRequire(new URL('./kordoc/package.json', import.meta.url));
const sharp = require('sharp');
import { PDFiumLibrary } from './kordoc/node_modules/@hyzyla/pdfium/dist/index.esm.js';
const [input, output] = process.argv.slice(2);
const files = new Map();
let totalBytes = 0;
async function png(bytes, original = false) {
  const pipeline = sharp(bytes, { limitInputPixels: 16_000_000 });
  if (!original)
    pipeline.resize({ width: 1100, height: 1500, fit: 'inside', withoutEnlargement: true });
  const image = await pipeline.png().toBuffer();
  if (image.length > 4 * 1024 * 1024) throw new Error('asset_limit');
  const hash = createHash('sha256').update(image).digest('hex');
  if (!files.has(hash)) {
    totalBytes += image.length;
    if (totalBytes > 64 * 1024 * 1024 || files.size >= 1000) throw new Error('asset_limit');
    await fs.writeFile(path.join(output, `${hash}.png`), image, { flag: 'wx' });
    files.set(hash, { sha256: hash, size: image.length });
  }
  return hash;
}
function chunks(text) {
  const result = [];
  let current = '';
  for (const char of text) {
    if (Buffer.byteLength(current + char) > 6000) {
      result.push(current);
      current = '';
    }
    current += char;
  }
  if (current.trim()) result.push(current);
  return result;
}
async function main() {
  const bytes = await fs.readFile(input);
  const parsed = await parse(bytes, {
    images: true,
    dropBlankImages: true,
    ocr: true,
    ocrRec: 'printed',
    ocrDet: 'mobile',
    ocrLines: true,
    formulaOcr: false,
    tableFormat: 'gfm',
  });
  if (!parsed.success) throw new Error('extract_failed');
  const incomplete = parsed.warnings?.find((w) =>
    ['OCR_FAILED', 'NEEDS_OCR', 'PARTIAL_PARSE', 'TRUNCATED_TABLE'].includes(w.code),
  );
  if (incomplete) throw new Error(incomplete.code);
  const type = parsed.fileType;
  const mode =
    type === 'pptx'
      ? 'slide'
      : ['xls', 'xlsx'].includes(type)
        ? 'sheet'
        : (parsed.metadata?.pageMode ?? (type === 'pdf' ? 'layout' : 'unpaginated'));
  const pages = new Map();
  const warnings = [...new Set((parsed.warnings ?? []).map((w) => w.code))];
  const images = imageIndex(parsed.images);
  const pageFor = (number) => {
    const key = number ?? 0;
    if (!pages.has(key))
      pages.set(key, {
        source_page: number ?? null,
        label: number
          ? `${mode === 'slide' ? '슬라이드' : mode === 'sheet' ? '시트' : mode === 'section' ? '섹션' : '페이지'} ${number}`
          : '문서 본문',
        preview: null,
        blocks: [],
      });
    if (pages.size > 500) throw new Error('page_limit');
    return pages.get(key);
  };
  const count = parsed.pageCount ?? parsed.metadata?.pageCount ?? 0;
  if (count > 500) throw new Error('page_limit');
  if (mode !== 'unpaginated') for (let i = 1; i <= count; i++) pageFor(i);
  async function append(block, inheritedPage) {
    const number = block.pageNumber ?? inheritedPage;
    const page = pageFor(number);
    let text = block.text ?? '';
    const attributes = {};
    if (block.level) attributes.level = block.level;
    if (block.bbox) attributes.bbox = block.bbox;
    if (block.table) {
      const table = tableContent(block.table);
      text = table.text;
      Object.assign(attributes, table.metadata);
    }
    const image = block.imageData ?? (block.type === 'image' ? images.get(block.text) : null);
    if (image?.data?.length) {
      try {
        attributes.image_sha256 = await png(Buffer.from(image.data), true);
        if (typeof image.source === 'string') attributes.source_image = image.source;
        text ||= '문서 이미지';
      } catch {
        warnings.push('IMAGE_PREVIEW_UNAVAILABLE');
      }
    }
    let textOffset = 0;
    for (const [part, content] of chunks(block.table ? text : text.trim()).entries()) {
      page.blocks.push({
        kind: block.type,
        text: content,
        attributes: { ...attributes, part, text_offset: textOffset },
      });
      textOffset += content.length;
    }
    for (const child of block.children ?? []) await append(child, number);
  }
  for (const block of parsed.blocks) await append(block);
  if ([...pages.values()].reduce((n, p) => n + p.blocks.length, 0) > 20000)
    throw new Error('block_limit');
  if (type === 'pdf') {
    const library = await PDFiumLibrary.init();
    const doc = await library.loadDocument(bytes);
    try {
      for (const p of doc.pages()) {
        const size = p.getOriginalSize();
        if (size.originalWidth <= 0 || size.originalHeight / size.originalWidth > 5) {
          warnings.push('PAGE_PREVIEW_UNAVAILABLE');
          continue;
        }
        const rendered = await p.render({
          width: 850,
          render: async ({ data, width, height }) =>
            sharp(data, { raw: { width, height, channels: 4 } })
              .png()
              .toBuffer(),
        });
        pageFor(p.number + 1).preview = await png(rendered.data);
      }
    } finally {
      doc.destroy();
      library.destroy();
    }
  } else if (['hwp', 'hwpx'].includes(type)) {
    try {
      const rendered = await renderDocument(bytes, { format: 'png', maxWidthPx: 850 });
      for (const asset of rendered.assets)
        if (asset.page) pageFor(asset.page).preview = await png(Buffer.from(asset.data));
    } catch {
      warnings.push('PAGE_PREVIEW_UNAVAILABLE');
    }
  }
  for (const p of parsed.ocrLines ?? []) {
    const page = pageFor(p.pageNumber ?? p.page);
    for (const block of page.blocks) block.attributes.ocr = true;
  }
  const result = {
    schema_version: 2,
    page_mode: mode,
    warnings: [...new Set(warnings)].slice(0, 1000),
    pages: [...pages.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v),
    files: [...files.values()],
  };
  const encoded = JSON.stringify(result);
  if (Buffer.byteLength(encoded) > 16 * 1024 * 1024) throw new Error('output_limit');
  await fs.writeFile(path.join(output, 'result.json'), encoded, { flag: 'wx' });
}
// Only these exit codes cross the process boundary. Parser messages can contain source text.
const failures = new Map([
  ['OCR_FAILED', 20],
  ['NEEDS_OCR', 20],
  ['PARTIAL_PARSE', 21],
  ['TRUNCATED_TABLE', 21],
  ['page_limit', 22],
  ['block_limit', 23],
  ['asset_limit', 23],
  ['output_limit', 23],
]);
main().catch((error) => {
  process.exitCode = failures.get(error?.message) ?? 1;
});
