// Purpose: Verify mock task docking, local-only progress and toast separation without a server.
// Pattern: Real browser/file URL with metadata-only fixtures and owned helper artifacts.
// Usage: node mock/helpers/work-feedback.cjs with PUPUTYX_BROWSER_TOOLS configured.
// Related: mock/js/feedback.js, app-events.js, mock/styles/feedback.css.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { openBrowser, projectRoot } = require('./browser.cjs');
(async () => {
  const session = await openBrowser('work-feedback');
  const root = fs.mkdtempSync(path.join(projectRoot, 'mock/helpers/.artifacts/work-feedback-'));
  const file = path.join(root, '팀 원본.pdf');
  fs.writeFileSync(file, 'metadata-only mock fixture');
  const captures = path.join(projectRoot, 'mock/captures/folio');
  try {
    const a = await session.browser.newPage(),
      b = await session.browser.newPage(),
      errors = [];
    for (const page of [a, b]) {
      page.on('pageerror', (e) => errors.push(e.message));
      await page.setViewport({ width: 1440, height: 1000 });
      await page.goto(pathToFileURL(projectRoot + '/mock/index.html').href + '#view=space', {
        waitUntil: 'networkidle0',
      });
    }
    await a.bringToFront();
    await a.click('[data-action="upload-asset"]');
    await (await a.$('#asset-files')).uploadFile(file);
    await a.click('[data-form="space-upload"] button[type="submit"]');
    await a.waitForSelector('.mock-work-dock:not([hidden])');
    assert.equal(await b.$eval('.mock-work-dock', (n) => n.hidden), true);
    await a.click('[data-task-toggle]');
    assert.equal(await a.$eval('#mock-task-body', (n) => n.hidden), true);
    await a.click('[data-task-close]');
    await a.click('.mock-work-launcher');
    assert.equal(await a.$eval('#mock-task-body', (n) => n.hidden), false);
    await a.click('#global-navigation a[href*="view=projects"]');
    await a.waitForSelector('#project-create-button');
    assert.equal(await a.$('.project-create-fab'), null);
    await a.waitForFunction(() =>
      document.querySelector('[data-task-summary]')?.textContent.includes('완료 1'),
    );
    await a.waitForSelector('.mock-toast');
    const aligned = await a.evaluate(() => {
      const panel = document.querySelector('.mock-work-dock').getBoundingClientRect();
      const toast = document.querySelector('.mock-toasts').getBoundingClientRect();
      return panel.bottom <= innerHeight && panel.right <= innerWidth && toast.bottom <= panel.top;
    });
    assert.ok(aligned);
    await a.screenshot({ path: path.join(captures, 'mock-work-panel-home.png'), fullPage: true });
    await a.click('#project-create-button');
    await a.waitForSelector('#app-dialog[open]');
    await a.keyboard.press('Escape');
    for (const width of [390, 320]) {
      await a.setViewport({ width, height: 844 });
      assert.ok(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      const rect = await a.$eval('.mock-work-dock', (n) => {
        const r = n.getBoundingClientRect();
        return { left: r.left, right: r.right, bottom: r.bottom, w: innerWidth, h: innerHeight };
      });
      assert.ok(rect.left >= 0 && rect.right <= rect.w && rect.bottom <= rect.h);
    }
    await a.screenshot({ path: path.join(captures, 'mock-work-panel-phone.png'), fullPage: false });
    await a.click('[data-task-clear]');
    assert.equal(await a.$eval('.mock-work-dock', (n) => n.hidden), true);
    await a.reload({ waitUntil: 'networkidle0' });
    assert.equal(await a.$eval('.mock-work-dock', (n) => n.hidden), true);
    assert.deepEqual(errors, []);
    console.log(
      'PASS: mock direct-file upload simulation, isolated tabs, collapse/close/reopen, route continuity, toast/panel separation, header creation, responsive bounds and refresh reset.',
    );
  } finally {
    await session.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
