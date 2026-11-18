// Purpose: Install or verify pinned Rust development CLI tools and matching LLVM tools.
// Pattern: Explicit setup boundary; runtime startup never installs development tools.
// Usage: node scripts/quality/rust-tools.mjs check|install|policy [--install]; coverage imports the toolchain value.
// Related: scripts/quality/dev-tools.json, rust-toolchain.toml, scripts/test/coverage.mjs.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const tools = JSON.parse(readFileSync(new URL('./dev-tools.json', import.meta.url), 'utf8'));
export const rustToolchain = readFileSync(
  new URL('../../rust-toolchain.toml', import.meta.url),
  'utf8',
).match(/^channel\s*=\s*"([^"]+)"/m)?.[1];
if (!rustToolchain) throw new Error('Missing pinned Rust toolchain.');

function output(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  if (result.error || result.status !== 0) return null;
  return result.stdout.trim();
}
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} failed (${result.status ?? result.signal}).`);
}
function llvmAvailable() {
  const prefix = ['run', rustToolchain, 'rustc'];
  const sysroot = output('rustup', [...prefix, '--print', 'sysroot']);
  const host = output('rustup', [...prefix, '-vV'])?.match(/^host: (.+)$/m)?.[1];
  return (
    sysroot &&
    host &&
    ['llvm-cov', 'llvm-profdata'].every((name) =>
      existsSync(
        join(
          sysroot,
          'lib',
          'rustlib',
          host,
          'bin',
          name + (process.platform === 'win32' ? '.exe' : ''),
        ),
      ),
    )
  );
}
function installedVersion(name) {
  return output('cargo', [name.slice(6), '--version'])?.match(/\d+\.\d+\.\d+/)?.[0];
}
function installIfNeeded(name) {
  if (installedVersion(name) !== tools[name]) {
    run('rustup', [
      'run',
      rustToolchain,
      'cargo',
      'install',
      '--locked',
      '--version',
      tools[name],
      name,
    ]);
  }
}
function checkPolicy(install) {
  for (const name of ['cargo-machete', 'cargo-deny']) {
    if (install) installIfNeeded(name);
    else if (installedVersion(name) !== tools[name])
      throw new Error(`Install pinned ${name} with pnpm tools:install`);
  }
  run('cargo', ['machete']);
  run('cargo', ['deny', '--locked', 'check', '--hide-inclusion-graph']);
}
export function checkTools() {
  const failures = [];
  for (const [name, version] of Object.entries(tools)) {
    const found = installedVersion(name);
    if (found !== version)
      failures.push(`${name}: expected ${version}, found ${found ?? 'not installed'}`);
  }
  if (!llvmAvailable())
    failures.push(`Rust ${rustToolchain} with llvm-tools-preview is required via rustup.`);
  if (failures.length) throw new Error(`${failures.join('\n')}\nRun pnpm tools:install.`);
  console.log('Pinned Rust development tools and LLVM components are available.');
}
function installTools() {
  if (!output('rustup', ['--version']))
    throw new Error('Install rustup before running tools:install.');
  run('rustup', [
    'toolchain',
    'install',
    rustToolchain,
    '--profile',
    'minimal',
    '--component',
    'rustfmt,clippy,llvm-tools-preview',
  ]);
  for (const name of Object.keys(tools)) installIfNeeded(name);
  checkTools();
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === 'install') installTools();
    else if (process.argv[2] === 'check') checkTools();
    else if (process.argv[2] === 'policy') checkPolicy(process.argv[3] === '--install');
    else
      throw new Error(
        'Usage: node scripts/quality/rust-tools.mjs check|install|policy [--install]',
      );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
