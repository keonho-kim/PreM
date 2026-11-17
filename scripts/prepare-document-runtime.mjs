#!/usr/bin/env node
// Purpose: Prepare and fingerprint local document tools before application execution.
// Pattern: Explicit build-time acquisition; runtime never installs packages or OCR models.
// Usage: node scripts/prepare-document-runtime.mjs after runtime packages are installed.
// Related: backend/tools/, runtime/kordoc/package-lock.json, runtime/ppt-master/REVISION.
import { prepareKordocFilter } from './prepare-kordoc-filter.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtime = path.join(root, 'runtime');
const versions = JSON.parse(
  await fs.readFile(path.join(root, 'scripts/runtime-versions.json'), 'utf8'),
);
const pythonMinor = versions.python.split('.').slice(0, 2).join('.');
for (const name of [
  'document-extract.mjs',
  'document-structure.mjs',
  'reference-materials.py',
  'reference-previews.mjs',
  'template-extract.py',
  'template-previews.mjs',
  'process-parent-watch.mjs',
])
  await fs.copyFile(path.join(root, 'backend/tools', name), path.join(runtime, name));
for (const name of [
  'presentation-render.py',
  'presentation-layers.py',
  'presentation-previews.mjs',
  'presentation-canvas.py',
  'presentation-quality.py',
  'presentation-assemble.py',
  'presentation-objects.py',
  'presentation-references.py',
  'presentation-image.mjs',
  'presentation-validate.mjs',
])
  await fs.copyFile(path.join(root, 'backend/tools', name), path.join(runtime, name));
const node = path.join(runtime, 'node/bin/node');
const pythonFolder = (await fs.readdir(path.join(runtime, 'python'))).find((name) =>
  name.startsWith(`cpython-${versions.python}-`),
);
if (!pythonFolder) throw new Error('Run pnpm runtime:install first');
const python = path.join(runtime, 'python', pythonFolder, `bin/python${pythonMinor}`);
execFileSync(
  python,
  [
    '-c',
    'import sys; sys.path.insert(0, sys.argv[1]); import pptx; assert pptx.__version__ == "1.0.2"',
    path.join(runtime, 'python-packages'),
  ],
  { env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, stdio: 'pipe' },
);
const modelPaths = ['det.onnx', 'rec_korean.onnx', 'rec_korean.yml'].map(
  (n) => `kordoc/models/ppocr/${n}`,
);
const filterFiles = await prepareKordocFilter(runtime);
const kordocPackage = JSON.parse(
  await fs.readFile(path.join(runtime, 'kordoc/node_modules/kordoc/package.json'), 'utf8'),
);
const kordocAssets = ['kordoc/node_modules/kordoc/dist/hayro-pdf.wasm'];
const entries = {};
for (const name of [
  'document-extract.mjs',
  'document-structure.mjs',
  'reference-materials.py',
  'reference-previews.mjs',
  'process-parent-watch.mjs',
  'template-extract.py',
  'template-previews.mjs',
  'kordoc/package-lock.json',
  'ppt-master/REVISION',
  ...modelPaths,
  ...kordocAssets,
  ...filterFiles,
])
  entries[name] = createHash('sha256')
    .update(await fs.readFile(path.join(runtime, name)))
    .digest('hex');
const manifest = {
  schema_version: 1,
  platform: process.platform,
  arch: process.arch,
  node: path.relative(runtime, node),
  python: path.relative(runtime, python),
  node_version: execFileSync(node, ['--version'], { encoding: 'utf8' }).trim(),
  python_version: execFileSync(python, ['--version'], { encoding: 'utf8' }).trim(),
  kordoc: kordocPackage.version,
  ppt_master: (await fs.readFile(path.join(runtime, 'ppt-master/REVISION'), 'utf8')).trim(),
  files: entries,
};
await fs.writeFile(
  path.join(runtime, 'document-manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log('Document runtime manifest written with bundled Node/Python and verified OCR models.');
