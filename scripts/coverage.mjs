// Purpose: Produce Rust coverage with the pinned rustup compiler and matching LLVM tools.
// Pattern: Owned child commands and reports isolated from application data.
// Usage: pnpm coverage:rust; reports go under tests/.artifacts/coverage/rust.
// Related: scripts/rust-tools.mjs, rust-toolchain.toml, dev-docs/07-quality-readiness.md.
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkTools, rustToolchain } from './rust-tools.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'tests/.artifacts/coverage/rust');
const env = {
  ...process.env,
  CARGO_TARGET_DIR: join(root, 'tests/.artifacts/coverage/rust-build'),
};
function run(args) {
  const result = spawnSync('rustup', ['run', rustToolchain, 'cargo', 'llvm-cov', ...args], {
    cwd: root,
    env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`Rust coverage failed (${result.status ?? result.signal}).`);
}
try {
  checkTools();
  mkdirSync(output, { recursive: true });
  const scope = ['--ignore-filename-regex', '[/\\\\]backend[/\\\\]tests[/\\\\]'];
  run([
    '--workspace',
    '--all-features',
    '--locked',
    '--lcov',
    '--output-path',
    join(output, 'lcov.info'),
    ...scope,
  ]);
  run(['report', '--html', '--output-dir', output, ...scope]);
  run(['report', ...scope]);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
