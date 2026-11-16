// Purpose: Produce passive thumbnails for reusable source objects, keeping native bytes separate.
// Pattern: Sharp reads bounded packaged media or crops a known slide preview; no source HTML/SVG is served.
// Usage: Runs after PPT Master import and slide rendering in one owned workspace.
// Related: reference-materials.py, adapters/processes/pptx.rs, reference-pptx.rs.
import { Worker } from 'node:worker_threads';
new Worker(new URL('./process-parent-watch.mjs', import.meta.url), {
  workerData: { parent: process.ppid },
}).unref();
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { isBlankImage } from './kordoc-image-filter.mjs';
const [runtime, output] = process.argv.slice(2);
const require = createRequire(path.join(runtime, 'kordoc/package.json'));
const sharp = require('sharp');
sharp.concurrency(1);
const data = JSON.parse(await fs.readFile(path.join(output, 'materials.json'), 'utf8'));
const pages = JSON.parse(await fs.readFile(path.join(output, 'previews.json'), 'utf8'));
const files = new Map();
const dropped = new Set();
const screened = new Map();
let total = 0;
async function publish(bytes) {
  if (bytes.length > 4 * 1024 * 1024) throw new Error('preview_limit');
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (!files.has(hash)) {
    total += bytes.length;
    if (total > 64 * 1024 * 1024 || files.size >= 1000) throw new Error('preview_limit');
    await fs.writeFile(path.join(output, `${hash}.png`), bytes);
    files.set(hash, { sha256: hash, size: bytes.length });
  }
  return hash;
}
for (const item of data.items) {
  const page = pages.find((p) => p.ordinal === item.source_page);
  if (!page) throw new Error('missing_page');
  const source = path.join(output, `preview-${page.ordinal}.png`);
  item.preview = await publish(await fs.readFile(source));
  item.preview_scope = item.kind === 'slide' ? 'item' : 'page';
  const asset = item.locator.image_asset;
  try {
    let image;
    if (asset) {
      const folder = path.join(output, 'template');
      const file = path.resolve(folder, asset);
      if (!file.startsWith(folder + path.sep) || (await fs.lstat(file)).isSymbolicLink())
        throw new Error('invalid_asset');
      if ((await fs.stat(file)).size > 32 * 1024 * 1024) throw new Error('asset_limit');
      const original = await fs.readFile(file);
      image = sharp(original, { limitInputPixels: 16000000 });
      if (item.kind === 'image') {
        let blank = screened.get(asset);
        if (blank === undefined) {
          const metadata = await image.metadata().catch(() => null);
          blank = await isBlankImage(
            original,
            metadata?.format ? `image/${metadata.format}` : 'application/octet-stream',
          );
          screened.set(asset, blank);
        }
        if (blank) {
          dropped.add(item.key);
          continue;
        }
      }
    } else if (item.bbox && item.kind !== 'slide') {
      const [x, y, w, h] = item.bbox;
      const width = data.slide_size.width_px,
        height = data.slide_size.height_px;
      if (!(width > 0 && height > 0 && w > 0 && h > 0)) continue;
      const left = Math.max(0, Math.floor((x / width) * page.width));
      const top = Math.max(0, Math.floor((y / height) * page.height));
      const right = Math.min(page.width, Math.ceil(((x + w) / width) * page.width));
      const bottom = Math.min(page.height, Math.ceil(((y + h) / height) * page.height));
      if (right <= left || bottom <= top) continue;
      image = sharp(await fs.readFile(source)).extract({
        left,
        top,
        width: right - left,
        height: bottom - top,
      });
    } else continue;
    const bytes = await image
      .resize({ width: 1100, height: 1100, fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();
    item.preview = await publish(bytes);
    item.preview_scope = 'item';
  } catch (error) {
    if (error instanceof Error && error.message === 'image_filter_unavailable') throw error;
    // Native source remains usable even when an embedded image codec cannot be previewed.
    item.preview_scope = 'page';
  }
}
await fs.writeFile(
  path.join(output, 'material-previews.json'),
  JSON.stringify({
    materials: data.items.filter((item) => !dropped.has(item.key)),
    files: [...files.values()],
  }),
);
