// Purpose: Rasterize full slides plus optional isolated artwork layers for safe canvas interaction.
// Pattern: Existing template preview owner runs first; Sharp emits passive bounded alpha PNGs.
// Usage: Node receives runtime root and the owned native rendering workspace.
// Related: presentation-layers.py, template-previews.mjs, processes/presentations.rs.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
await import('./template-previews.mjs');
const [runtime, folder] = process.argv.slice(2);
const require = createRequire(path.join(runtime, 'kordoc/package.json'));
const sharp = require('sharp');
sharp.concurrency(1);
const rows = JSON.parse(await fs.readFile(path.join(folder, 'layers.json'), 'utf8'));
if (rows.length > 21) throw Error('layer_limit');
let total = 0;
for (const [index, row] of rows.entries()) {
  if (row.file !== `layer-${index}.svg`) throw Error('invalid_layer');
  const bytes = await fs.readFile(path.join(folder, row.file));
  if (bytes.length > 16 * 1024 * 1024) throw Error('layer_limit');
  let image = sharp(bytes, { limitInputPixels: 16000000 })
    .resize({
      width: Math.max(1, Math.ceil((row.frame.width / 100) * 1440)),
      height: Math.max(1, Math.ceil((row.frame.height / 100) * 1080)),
      fit: 'inside',
    })
    .png();
  if (row.id === 'background') image = image.flatten({ background: '#ffffff' });
  const data = await image.toBuffer();
  total += data.length;
  if (data.length > 4 * 1024 * 1024 || total > 64 * 1024 * 1024) throw Error('layer_limit');
  row.file = `layer-${index}.png`;
  await fs.writeFile(path.join(folder, row.file), data, { flag: 'wx' });
}
await fs.writeFile(path.join(folder, 'layers.json'), JSON.stringify(rows));
