// Purpose: Rasterize PPT Master slide projections into passive template preview images.
// Pattern: Bundled Sharp, bounded local files and no browser execution of source SVG.
// Usage: Node receives runtime root and the owned template workspace after extraction.
// Related: template-extract.py, adapters/processes/templates.rs.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';
const [runtime, output] = process.argv.slice(2);
new Worker(new URL('./process-parent-watch.mjs', import.meta.url), {
  workerData: { parent: process.ppid },
}).unref();
const require = createRequire(path.join(runtime, 'kordoc/package.json'));
const sharp = require('sharp');
sharp.concurrency(1);
const folder = path.join(output, 'template/svg-flat');
const slides = (await fs.readdir(folder))
  .filter((name) => /^slide_\d+\.svg$/.test(name))
  .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
if (!slides.length || slides.length > 500) throw new Error('preview_limit');
const previews = [];
let total = 0;
for (const [index, name] of slides.entries()) {
  const source = path.join(folder, name);
  const stat = await fs.lstat(source);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024)
    throw new Error('preview_limit');
  const bytes = await fs.readFile(source);
  const { data, info } = await sharp(bytes, { limitInputPixels: 16000000 })
    .resize({ width: 1440, height: 1080, fit: 'inside' })
    .flatten({ background: '#ffffff' })
    .png()
    .toBuffer({ resolveWithObject: true });
  total += data.length;
  if (data.length > 4 * 1024 * 1024 || total > 64 * 1024 * 1024) throw new Error('preview_limit');
  const ordinal = index + 1;
  await fs.writeFile(path.join(output, `preview-${ordinal}.png`), data, { flag: 'wx' });
  previews.push({ ordinal, width: info.width, height: info.height, sha256: '', size: data.length });
}
await fs.writeFile(path.join(output, 'previews.json'), JSON.stringify(previews));
