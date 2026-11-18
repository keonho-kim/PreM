#!/usr/bin/env node
// Purpose: Reject drift between version owners, manifests and reviewed runtime adapters.
// Pattern: Read canonical files; no package installation or generated source mutation.
// Usage: pnpm check:versions [vYYYYMMDD] to validate the optional package tag.
// Related: .node-version, rust-toolchain.toml, runtime-versions.json, package.json.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const json = (name) => JSON.parse(read(name));
const app = json('package.json'),
  frontend = json('frontend/package.json');
const version = read('Cargo.toml').match(/^version = "([^"]+)"/m)?.[1];
if (
  !/^20\d{2}\.\d{2}\.\d{2}$/.test(version ?? '') ||
  app.version !== version ||
  frontend.version !== version
)
  throw new Error('Root, frontend and Rust date versions must match');
if (!read('Cargo.lock').includes(`name = "prem-backend"\nversion = "${version}"`))
  throw new Error('Cargo.lock package version drift');
const tag = process.argv.slice(2).find((value) => value !== '--');
if (tag && tag !== `v${version.replaceAll('.', '')}`)
  throw new Error('Release tag does not match source version');
const node = read('.node-version').trim();
if (!app.engines.node.startsWith(`>=${node} `))
  throw new Error('Node engine minimum and .node-version differ');
if (!app.packageManager.startsWith('pnpm@')) throw new Error('Missing pinned package manager');
const runtime = json('scripts/runtime-versions.json');
if (
  !/^3\.\d+\.\d+$/.test(runtime.python) ||
  !/^\d+\.\d+\.\d+$/.test(runtime.uv) ||
  !/^\d+\.\d+\.\d+$/.test(runtime.puppeteer) ||
  !/^[a-f0-9]{40}$/.test(runtime.pptMaster)
)
  throw new Error('Invalid runtime version pin');
const kordoc = json('runtime/kordoc/package.json').dependencies.kordoc;
if (json('runtime/kordoc/package-lock.json').packages['node_modules/kordoc'].version !== kordoc)
  throw new Error('Kordoc lockfile drift');
if (!read('scripts/prepare-kordoc-filter.mjs').includes(`pkg.version !== '${kordoc}'`))
  throw new Error('Kordoc adapter review required');
console.log(`Version contracts verified: PreM ${version}, Node ${node}, Kordoc ${kordoc}`);
