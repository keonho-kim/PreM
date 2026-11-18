#!/usr/bin/env node
// Purpose: Run every browser journey with owned subprocesses and a complete result summary.
// Pattern: Sequential isolated suites, bounded runtime and continued reporting after failures.
// Usage: pnpm test:e2e [suite-name ...]; requires the compiled app and browser tools.
// Related: tests/e2e/suites.json, tests/helpers/browser.cjs, tests/.artifacts/e2e/.
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../../', import.meta.url));
const catalog = JSON.parse(await readFile(path.join(root, 'tests/e2e/suites.json'), 'utf8'));
const selected = process.argv.slice(2).filter((value) => value !== '--');
const suites = selected.length ? selected : catalog;
if (suites.some((name) => !catalog.includes(name))) throw new Error('Unknown browser suite');
const output = path.join(root, 'tests/.artifacts/e2e');
await mkdir(output, { recursive: true });
const results = [];
let child;
let interrupted = false;
const stop = () => {
  if (child) {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {}
  }
};
const interrupt = () => {
  interrupted = true;
  stop();
};
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);
for (const name of suites) {
  if (interrupted) break;
  const start = Date.now(),
    log = createWriteStream(path.join(output, `${name}.log`));
  child = spawn(process.execPath, [`tests/e2e/${name}.cjs`], {
    cwd: root,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  let timedOut = false,
    force;
  const timer = setTimeout(() => {
    timedOut = true;
    stop();
    force = setTimeout(() => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {}
    }, 5000);
  }, 300000);
  const status = await new Promise((resolve) => {
    child.once('error', () => resolve(1));
    child.once('close', (code) => resolve(code ?? 1));
  });
  clearTimeout(timer);
  clearTimeout(force);
  child = null;
  await new Promise((resolve) => log.end(resolve));
  results.push({ name, status, timedOut, elapsed_ms: Date.now() - start });
  console.log(
    `${status === 0 ? 'PASS' : 'FAIL'} ${name} (${Math.round((Date.now() - start) / 1000)}s)`,
  );
  if (status !== 0)
    console.log((await readFile(path.join(output, `${name}.log`), 'utf8')).slice(-2500));
  await writeFile(path.join(output, 'report.json'), `${JSON.stringify(results, null, 2)}\n`);
}
process.removeListener('SIGINT', interrupt);
process.removeListener('SIGTERM', interrupt);
console.log(
  `Browser journeys: ${results.filter((r) => r.status === 0).length}/${results.length} passed`,
);
process.exitCode = interrupted ? 130 : results.some((r) => r.status !== 0) ? 1 : 0;
