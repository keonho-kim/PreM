// Purpose: Own the local browser tool, isolated profiles, and helper output paths.
// Pattern: Development-only browser adapter with explicit cleanup.
// Usage: Required by product E2E journeys under tests/e2e/.
// Related: tests/.artifacts/, tests/e2e/server.cjs.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const projectRoot = path.resolve(__dirname, '../..');
const artifacts = path.join(projectRoot, 'tests/.artifacts');
async function openBrowser(name) {
  const tools = process.env.PREM_BROWSER_TOOLS || path.join(artifacts, 'browser-tools');
  const toolRequire = createRequire(path.join(tools, 'noop.js'));
  fs.mkdirSync(path.join(artifacts, 'captures/folio'), { recursive: true });
  let puppeteer;
  try {
    puppeteer = toolRequire('puppeteer-core');
  } catch {
    throw new Error(
      'Set PREM_BROWSER_TOOLS to a development tools directory containing puppeteer-core.',
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
    try {
      await browser.close();
    } finally {
      // Chrome crash reporting/updater descendants can inherit these pipes after Chrome exits.
      // Release our readers so a finished QA journey does not retain the Node event loop.
      browser.process()?.stdout?.destroy();
      browser.process()?.stderr?.destroy();
      fs.rmSync(profile, { recursive: true, force: true });
    }
  };
  return { browser, close };
}
module.exports = { openBrowser, projectRoot, artifacts };
