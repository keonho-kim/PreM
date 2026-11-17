#!/usr/bin/env node
// Purpose: Install the exact Chrome for Testing revision supported by the pinned Puppeteer.
// Pattern: Disposable QA tools only; never include browser downloads in the application runtime.
// Usage: node scripts/install-test-browser.mjs after installing tests/.artifacts/browser-tools.
// Related: tests/helpers/browser.cjs, runtime-versions.json, .github/workflows/release.yml.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const tools = path.join(root, 'tests/.artifacts/browser-tools');
const require = createRequire(path.join(tools, 'noop.js'));
const { PUPPETEER_REVISIONS } = require('puppeteer-core');
const { install, Browser } = require('@puppeteer/browsers');
const browser = await install({
  browser: Browser.CHROME,
  buildId: PUPPETEER_REVISIONS.chrome,
  cacheDir: path.join(tools, 'browsers'),
});
await writeFile(path.join(tools, 'chrome-path.txt'), browser.executablePath + '\n');
console.log(`Chrome for Testing ${browser.buildId}: ${browser.executablePath}`);
