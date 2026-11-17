#!/usr/bin/env node
// Purpose: Acquire pinned document runtimes during an explicit development/build step.
// Pattern: Verify Node archive, retain full PPT Master attribution, lock npm dependencies and prefetch OCR.
// Usage: pnpm runtime:install; never invoked by application startup.
// Related: prepare-document-runtime.mjs, runtime/, backend/tools/.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtime = path.join(root, 'runtime');
await fs.mkdir(path.join(root, 'tests/.artifacts'), { recursive: true });
const scratch = await fs.mkdtemp(path.join(root, 'tests/.artifacts/runtime-build-'));
const run = (command, args, env = {}) =>
  execFileSync(command, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });
const nodeVersion = '26.13.0',
  pythonVersion = '3.13.18',
  revision = '3af3e8ef774c4d67ee57e1306d9256d08c9ee1bf';
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
  const pythonRoot = (await fs.readdir(path.join(runtime, 'python'))).find(
    (n) => n.startsWith(`cpython-${pythonVersion}-`) && !n.startsWith('.'),
  );
  if (!pythonRoot) throw new Error('Bundled Python missing');
  const python = path.join(runtime, 'python', pythonRoot, 'bin', 'python3.13');
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
    path.join(root, 'scripts/runtime-python.lock'),
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
  run(node, [path.join(root, 'scripts/prepare-document-runtime.mjs')], {
    PREM_BUILD_PYTHON: python,
  });
} finally {
  await fs.rm(scratch, { recursive: true, force: true });
}
