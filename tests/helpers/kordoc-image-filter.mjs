// Purpose: Verify the pinned Kordoc filter removes blank images but preserves useful tiny icons.
// Pattern: Actual upstream code and synthetic local bytes; no OCR, LLM, network or application data.
// Usage: runtime/node/bin/node --test tests/helpers/kordoc-image-filter.mjs.
// Related: scripts/prepare-kordoc-filter.mjs, backend/tools/reference-previews.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { isBlankImage } from '../../runtime/kordoc-image-filter.mjs';
const require = createRequire(new URL('../../runtime/kordoc/package.json', import.meta.url));
const sharp = require('sharp');
test('uniform large background is blank; a tiny patterned icon and transparent glyph are not', async () => {
  const blank = await sharp({
    create: { width: 240, height: 160, channels: 4, background: '#e5eee8' },
  })
    .png()
    .toBuffer();
  assert.equal(await isBlankImage(blank, 'image/png'), true);
  const pixels = Buffer.alloc(8 * 8 * 4);
  for (let i = 0; i < 64; i++) {
    const white = i % 2 === 0;
    pixels[i * 4] = white ? 255 : 0;
    pixels[i * 4 + 1] = white ? 255 : 0;
    pixels[i * 4 + 2] = white ? 255 : 0;
    pixels[i * 4 + 3] = 255;
  }
  const tiny = await sharp(pixels, { raw: { width: 8, height: 8, channels: 4 } })
    .png()
    .toBuffer();
  assert.equal(await isBlankImage(tiny, 'image/png'), false);
  const alpha = Buffer.alloc(16 * 16 * 4);
  for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) alpha[(y * 16 + x) * 4 + 3] = 255;
  const glyph = await sharp(alpha, { raw: { width: 16, height: 16, channels: 4 } })
    .png()
    .toBuffer();
  assert.equal(await isBlankImage(glyph, 'image/png'), false);
  assert.equal(await isBlankImage(Buffer.from('undecodable'), 'application/octet-stream'), false);
});
test('public document parse applies dropBlankImages without dropping document text', async () => {
  const { readFile } = await import('node:fs/promises');
  const { parse } = await import('../../runtime/kordoc/node_modules/kordoc/dist/index.js');
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(
    await readFile(new URL('../fixtures/documents/office.docx', import.meta.url)),
  );
  const media = Object.keys(zip.files).filter(
    (name) => name.startsWith('word/media/') && !zip.files[name].dir,
  );
  assert.equal(media.length, 1);
  const blank = await sharp({
    create: { width: 120, height: 80, channels: 3, background: '#e5eee8' },
  })
    .png()
    .toBuffer();
  zip.file(media[0], blank);
  const bytes = await zip.generateAsync({ type: 'nodebuffer' });
  const before = await parse(bytes, { images: true, ocr: false, dropBlankImages: false });
  const after = await parse(bytes, { images: true, ocr: false, dropBlankImages: true });
  assert.equal(before.success, true);
  assert.equal(after.success, true);
  assert.equal(before.images.length, 1);
  assert.equal(after.images?.length ?? 0, 0);
  assert.match(after.markdown, /Contents/);
});
