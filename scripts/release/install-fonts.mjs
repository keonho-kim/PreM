// Purpose: Acquire pinned Korean and interface fonts for offline slide rendering.
// Pattern: Build-only verified upstream downloads; package includes source font licenses.
// Usage: node scripts/release/install-fonts.mjs before packaging.
// Related: package.py, runtime/fonts.conf, frontend font dependencies.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const folder = path.join(root, 'runtime/fonts');
const revision = '7af0d90b4d532ffa4b041937b560c6df4e7b1e95';
await fs.mkdir(folder, { recursive: true });
const files = ['NotoSansKR[wght].ttf', 'OFL.txt'];
const manifest = [];
for (const name of files) {
  const url = `https://raw.githubusercontent.com/google/fonts/${revision}/ofl/notosanskr/${encodeURIComponent(name)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Font acquisition failed: ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(path.join(folder, name), data);
  manifest.push({ name, url, sha256: createHash('sha256').update(data).digest('hex') });
}
await fs.writeFile(path.join(folder, 'sources.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log('Pinned Korean font and license prepared.');
