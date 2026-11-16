// Purpose: Verify the real CLI token gate, lock/re-entry, independent contexts and restart expiry.
// Pattern: Raw fetch proves unauthorized boundaries; only server.unlock enters valid test credentials.
// Usage: After pnpm build; captures contain no tokens and app storage is isolated.
// Related: server.cjs, backend/tests/admin_access.rs, features/admin-access/.
const assert = require('node:assert/strict');
const path = require('node:path');
const { createServer } = require('./server.cjs');
const { openBrowser, projectRoot } = require('../../mock/helpers/browser.cjs');
(async () => {
  const server = await createServer('admin-access-');
  let session;
  try {
    await server.start();
    session = await openBrowser('admin-access');
    const a = await (await session.browser.createBrowserContext()).newPage(),
      b = await (await session.browser.createBrowserContext()).newPage();
    const errors = [];
    for (const p of [a, b]) p.on('pageerror', (e) => errors.push(e.message));
    assert.equal((await fetch(server.base + '/api/v1/admin/llm/providers')).status, 401);
    assert.equal((await fetch(server.base + '/api/v1/models/authoring')).status, 200);
    assert.equal((await fetch(server.base + '/api/v1/projects')).status, 200);
    const url = server.base + '/home/admin?section=processing';
    await a.setViewport({ width: 1440, height: 1000 });
    await a.goto(url, { waitUntil: 'networkidle0' });
    await a.waitForSelector('#admin-token');
    assert.equal(await a.$('.admin-layout'), null);
    await a.type('#admin-token', 'wrong');
    await a.click('.admin-access-form button[type=submit]');
    await a.waitForSelector('[role=alert]');
    await a.$eval('#admin-token', (n) => n.select());
    await a.keyboard.press('Backspace');
    await a.screenshot({ path: path.join(projectRoot, 'mock/captures/folio/admin-token.png') });
    await server.unlock(a);
    assert.ok(a.url().includes('section=processing'));
    await b.goto(url, { waitUntil: 'networkidle0' });
    await b.waitForSelector('#admin-token');
    assert.equal(await b.$('.admin-layout'), null);
    await a.click('a[href="/home"]');
    await a.waitForSelector('.admin-layout', { hidden: true });
    await a.click('a[href="/home/admin"]');
    await a.waitForSelector('#admin-token');
    await server.unlock(a);
    await a.reload({ waitUntil: 'networkidle0' });
    await a.waitForSelector('#admin-token');
    await server.unlock(a);
    await server.unlock(b);
    await a.click('a[href*="section=general"]');
    await a.waitForSelector('#admin-new-token', { visible: true });
    const replacement = 'synthetic-Changed-Admin-token-2026';
    await a.type('#admin-new-token', replacement);
    await a.type('#admin-repeat-token', replacement);
    await a.click('.admin-general button[type=submit]');
    await a.waitForSelector('[role=alertdialog]');
    await a.screenshot({ path: path.join(projectRoot, 'mock/captures/folio/admin-general.png') });
    await (
      await a.waitForSelector('::-p-aria(확인하고 변경[role="button"])', { visible: true })
    ).click();
    await a.waitForSelector('#admin-token', { visible: true });
    await b.click('a[href*="section=general"]');
    await b.waitForSelector('#admin-token', { visible: true });
    assert.equal((await fetch(server.base + '/api/v1/projects')).status, 200);
    assert.equal((await fetch(server.base + '/api/v1/models/authoring')).status, 200);
    await a.type('#admin-token', replacement);
    await a.click('.admin-access-form button[type=submit]');
    await a.waitForSelector('.admin-layout');
    await server.stop();
    await server.start();
    // An explicit protected request through the real Admin UI detects the replaced server token.
    await a.click('a[href*="section=providers"]');
    await a.waitForSelector('#admin-token', { visible: true, timeout: 20000 });
    await server.unlock(a);
    await (await a.waitForSelector('.admin-access-bar button', { visible: true })).click();
    await a.waitForSelector('#admin-token');
    assert.equal(await a.evaluate(() => localStorage.length + sessionStorage.length), 0);
    await a.setViewport({ width: 320, height: 844 });
    assert.ok(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await a.screenshot({
      path: path.join(projectRoot, 'mock/captures/folio/admin-token-phone.png'),
    });
    assert.deepEqual(errors, []);
    console.log(
      'PASS: protected Admin APIs, safe public authoring, wrong token, memory-only unlock, leave/reload lock, independent browsers, temporary General token change, public services and restart reset.',
    );
  } finally {
    if (session) await session.close();
    await server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
