#!/usr/bin/env node
// Purpose: Install or prepare the pinned document processing runtime.
// Pattern: Install acquires dependencies; prepare verifies installed tools and writes the manifest.
// Usage: pnpm runtime:install or node scripts/runtime/documents.mjs prepare.
// Related: kordoc-filter.mjs, versions.json, requirements.lock, backend/tools/.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { prepareKordocFilter } from './kordoc-filter.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const runtime = path.join(root, 'runtime');
const versions = JSON.parse(await fs.readFile(new URL('./versions.json', import.meta.url), 'utf8'));
const pythonVersion = versions.python;

async function bundledPython() {
  const pythonRoot = (await fs.readdir(path.join(runtime, 'python'))).find(
    (n) => n.startsWith(`cpython-${pythonVersion}-`) && !n.startsWith('.'),
  );
  if (!pythonRoot)
    throw new Error(`Bundled Python ${pythonVersion} missing. Run pnpm runtime:install.`);
  return path.join(
    runtime,
    'python',
    pythonRoot,
    'bin',
    `python${pythonVersion.split('.').slice(0, 2).join('.')}`,
  );
}

async function install() {
  const run = (command, args, env = {}) =>
    execFileSync(command, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });
  const nodeVersion = (await fs.readFile(path.join(root, '.node-version'), 'utf8')).trim();
  const revision = versions.pptMaster;
  await fs.mkdir(path.join(root, 'tests/.artifacts'), { recursive: true });
  const scratch = await fs.mkdtemp(path.join(root, 'tests/.artifacts/runtime-build-'));
  try {
    if (!['darwin', 'linux'].includes(process.platform) || !['arm64', 'x64'].includes(process.arch))
      throw new Error('Build this bundle on a supported target OS/CPU');
    const archive = `node-v${nodeVersion}-${process.platform}-${process.arch}.tar.gz`;
    const checksums = await (
      await fetch(`https://nodejs.org/dist/v${nodeVersion}/SHASUMS256.txt`)
    ).text();
    const expected = checksums
      .split('\n')
      .find((line) => line.endsWith(`  ${archive}`))
      ?.split(' ')[0];
    if (!expected) throw new Error('Official Node checksum missing');
    const bytes = Buffer.from(
      await (await fetch(`https://nodejs.org/dist/v${nodeVersion}/${archive}`)).arrayBuffer(),
    );
    if (createHash('sha256').update(bytes).digest('hex') !== expected)
      throw new Error('Node checksum mismatch');
    await fs.writeFile(path.join(scratch, archive), bytes);
    await fs.mkdir(path.join(runtime, 'node'), { recursive: true });
    run('tar', [
      '-xzf',
      path.join(scratch, archive),
      '-C',
      path.join(runtime, 'node'),
      '--strip-components=1',
    ]);
    run('uv', ['python', 'install', '--install-dir', path.join(runtime, 'python'), pythonVersion]);
    const python = await bundledPython();
    run('npm', [
      'ci',
      '--prefix',
      path.join(runtime, 'kordoc'),
      '--omit=dev',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
    ]);
    run('uv', [
      'pip',
      'install',
      '--python',
      python,
      '--target',
      path.join(runtime, 'python-packages'),
      '--require-hashes',
      '-r',
      path.join(root, 'scripts/runtime/requirements.lock'),
    ]);
    const node = path.join(runtime, 'node/bin/node');
    run(node, [path.join(runtime, 'kordoc/node_modules/kordoc/dist/cli.js'), 'check-ocr-models'], {
      KORDOC_MODEL_CACHE: path.join(runtime, 'kordoc/models'),
    });
    const source = Buffer.from(
      await (
        await fetch(`https://api.github.com/repos/hugohe3/ppt-master/tarball/${revision}`)
      ).arrayBuffer(),
    );
    await fs.writeFile(path.join(scratch, 'ppt-master.tar.gz'), source);
    await fs.mkdir(path.join(runtime, 'ppt-master/source'), { recursive: true });
    run('tar', [
      '-xzf',
      path.join(scratch, 'ppt-master.tar.gz'),
      '-C',
      path.join(runtime, 'ppt-master/source'),
      '--strip-components=1',
    ]);
    await fs.writeFile(path.join(runtime, 'ppt-master/REVISION'), `${revision}\n`);
    await fs.writeFile(
      path.join(runtime, 'ppt-master/ARCHIVE_SHA256'),
      `${createHash('sha256').update(source).digest('hex')}\n`,
    );
    run(node, [fileURLToPath(import.meta.url), 'prepare']);
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
  }
}

async function prepare() {
  const documentTools = [
    'document-extract.mjs',
    'document-structure.mjs',
    'reference-materials.py',
    'reference-previews.mjs',
    'process-parent-watch.mjs',
    'template-extract.py',
    'template-previews.mjs',
  ];
  for (const name of [
    ...documentTools,
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
  const python = await bundledPython();
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
    ...documentTools,
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
  console.log(
    'Document runtime manifest written with bundled Node/Python and verified OCR models.',
  );
}

switch (process.argv[2]) {
  case 'install':
    await install();
    break;
  case 'prepare':
    await prepare();
    break;
  default:
    throw new Error('Usage: node scripts/runtime/documents.mjs install|prepare');
}
