// Purpose: Own the local browser tool, isolated profiles, and helper output paths.
// Pattern: Development-only browser adapter with explicit cleanup.
// Usage: Required by mock/helpers/smoke.cjs and capture.cjs.
// Related: mock/helpers/.artifacts/, mock/captures/.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const projectRoot = path.resolve(__dirname, '../..');
const artifacts = path.join(__dirname, '.artifacts');
const baseURL = process.env.PUPUTYX_MOCK_URL || 'http://127.0.0.1:5174/';
async function openBrowser(name) {
  const toolRequire = process.env.PUPUTYX_BROWSER_TOOLS
    ? createRequire(path.join(process.env.PUPUTYX_BROWSER_TOOLS, 'noop.js'))
    : require;
  let puppeteer;
  try {
    puppeteer = toolRequire('puppeteer-core');
  } catch {
    throw new Error(
      'Set PUPUTYX_BROWSER_TOOLS to a development tools directory containing puppeteer-core.',
    );
  }
  const chrome = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].find((candidate) => candidate && fs.existsSync(candidate));
  if (!chrome) throw new Error('Set CHROME_PATH to an installed Chrome or Chromium executable.');
  const profile = path.join(artifacts, 'browser-' + name + '-' + process.pid);
  const temporary = path.join(artifacts, 'tmp');
  fs.mkdirSync(temporary, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    userDataDir: profile,
    env: { ...process.env, TMPDIR: temporary },
  });
  const close = async () => {
    await browser.close();
    fs.rmSync(profile, { recursive: true, force: true });
  };
  return { browser, close };
}
module.exports = { openBrowser, projectRoot, artifacts, baseURL };
