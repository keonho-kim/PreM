#!/usr/bin/env node
// Purpose: Apply identical Rust dependency/license policy checks locally and in CI.
// Pattern: Only install explicitly requested, pinned development CLIs; no runtime consumer.
// Usage: node scripts/rust-policy.mjs check|install; install also runs the checks.
// Related: dev-tools.json, deny.toml, quality-check.sh.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const versions = JSON.parse(readFileSync(new URL('./dev-tools.json', import.meta.url), 'utf8'));
const mode = process.argv[2];
if (!['check', 'install'].includes(mode)) throw new Error('Use check or install');
function run(args) {
  const result = spawnSync('cargo', args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
for (const name of ['cargo-machete', 'cargo-deny']) {
  const output = spawnSync('cargo', [name.slice(6), '--version'], { encoding: 'utf8' });
  const actual = output.stdout?.match(/\d+\.\d+\.\d+/)?.[0];
  if (actual !== versions[name]) {
    if (mode !== 'install') throw new Error(`Install pinned ${name} with pnpm tools:install`);
    run(['install', '--locked', '--version', versions[name], name]);
  }
}
run(['machete']);
run(['deny', '--locked', 'check', '--hide-inclusion-graph']);
