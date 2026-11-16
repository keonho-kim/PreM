// Purpose: Verify shared Folio styling in the real embedded frontend.
// Pattern: Isolated application smoke check with owned server and browser lifetimes.
// Usage: Run after pnpm build; node mock/helpers/check-production-theme.cjs.
// Related: mock/helpers/browser.cjs, design/refract.tokens.json, scripts/build.sh.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { openBrowser, projectRoot, artifacts } = require('./browser.cjs');

async function stop(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  const exit = once(child, 'exit');
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  try {
    child.kill('SIGTERM');
    await exit;
  } finally {
    clearTimeout(timer);
  }
}
(async () => {
  const binary = path.join(projectRoot, 'target/release/PuPuTyX');
  assert.ok(fs.existsSync(binary), 'Run pnpm build first.');
  const testRoot = path.join(projectRoot, 'tests/.artifacts');
  fs.mkdirSync(testRoot, { recursive: true });
  const storage = fs.mkdtempSync(path.join(testRoot, 'folio-theme-'));
  const reservation = net.createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise((resolve, reject) =>
    reservation.close((error) => (error ? reject(error) : resolve())),
  );
  const base = 'http://127.0.0.1:' + port;
  const child = spawn(
    binary,
    ['--data-storage-path', storage, '--listen-address', '127.0.0.1', '--port', String(port)],
    { cwd: projectRoot, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let log = '',
    browserSession;
  for (const output of [child.stdout, child.stderr])
    output.on('data', (chunk) => {
      log = (log + chunk).slice(-16000);
    });
  child.on('error', (error) => {
    log += error.message;
  });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      assert.equal(child.exitCode, null, log);
      try {
        const response = await fetch(base + '/healthz', { signal: AbortSignal.timeout(500) });
        ready = response.ok && (await response.json()).service === 'PuPuTyX';
      } catch {}
      if (ready) break;
      await delay(100);
    }
    assert.ok(ready, 'Application did not become ready: ' + log);
    browserSession = await openBrowser('production');
    const page = await browserSession.browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('requestfailed', (request) =>
      errors.push(request.url() + ': ' + request.failure()?.errorText),
    );
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto(base + '/home/system', { waitUntil: 'networkidle0' });
    await page.waitForSelector('.system-details');
    await page.evaluate(() => document.fonts.ready);
    const theme = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const header = getComputedStyle(document.querySelector('.app-header'));
      const button = getComputedStyle(document.querySelector('.ui-button-primary'));
      return {
        brand: root.getPropertyValue('--color-brand').trim(),
        mode: root.colorScheme,
        headerFilter: header.backdropFilter,
        buttonBackground: button.backgroundColor,
        text: document.querySelector('.status-message').textContent.trim(),
      };
    });
    const canonical = JSON.parse(
      fs.readFileSync(path.join(projectRoot, 'design/refract.tokens.json'), 'utf8'),
    );
    const brand = canonical.properties['--color-brand'];
    assert.equal(theme.brand.toLowerCase(), brand.toLowerCase());
    assert.equal(theme.mode, 'light');
    assert.equal(theme.headerFilter, 'none');
    const rgb = brand
      .slice(1)
      .match(/../g)
      .map((part) => parseInt(part, 16));
    assert.equal(
      theme.buttonBackground,
      `rgb(${rgb.join(', ')})`,
      'Primary command uses canonical brand',
    );
    assert.deepEqual(errors, []);
    const captures = path.join(projectRoot, 'mock/captures/folio');
    fs.mkdirSync(captures, { recursive: true });
    await page.screenshot({ path: path.join(captures, 'production-scaffold.png'), fullPage: true });
    fs.mkdirSync(artifacts, { recursive: true });
    fs.writeFileSync(
      path.join(artifacts, 'production-theme.json'),
      JSON.stringify({ theme, errors }, null, 2),
    );
    console.log(
      'Embedded frontend consumes the canonical tangerine color, opaque paper surfaces and light mode.',
    );
  } finally {
    try {
      if (browserSession) await browserSession.close();
    } finally {
      try {
        await stop(child);
      } finally {
        fs.rmSync(storage, { recursive: true, force: true });
      }
    }
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
