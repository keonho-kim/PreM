// Purpose: Decode a bounded uploaded raster into a passive PNG for native slide pictures.
// Pattern: Sharp validates dimensions/format; strips metadata and never loads remote resources.
// Usage: Supervised bundled Node receives an owned input/output directory.
// Related: processes/presentation_media.rs, presentation media API.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const sharp = createRequire(new URL('./kordoc/package.json', import.meta.url))('sharp');
sharp.concurrency(1);
const folder = process.argv[2];
const bytes = await fs.readFile(path.join(folder, 'input'));
if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw Error('image_limit');
const image = sharp(bytes, { limitInputPixels: 16000000, failOn: 'warning', animated: false });
const meta = await image.metadata();
if (!['png', 'jpeg', 'webp'].includes(meta.format) || (meta.pages ?? 1) !== 1)
  throw Error('image_format');
const { data, info } = await image.rotate().png().toBuffer({ resolveWithObject: true });
if (data.length > 8 * 1024 * 1024) throw Error('image_limit');
await fs.writeFile(path.join(folder, 'image.png'), data);
await fs.writeFile(
  path.join(folder, 'image.json'),
  JSON.stringify({
    width: info.width,
    height: info.height,
    source_mime: `image/${meta.format}`,
  }),
);
