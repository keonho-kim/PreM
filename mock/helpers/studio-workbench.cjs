// Purpose: Verify always-visible Studio progress and independent editor panels in the direct-file mock.
// Pattern: Isolated browser, real keyboard/pointer controls and current Folio captures.
// Usage: PREM_BROWSER_TOOLS=... node mock/helpers/studio-workbench.cjs.
// Related: mock/js/studio.js, mock/styles/workspace-flow.css, editor-support.js.
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { openBrowser, projectRoot } = require('./browser.cjs');
(async () => {
  const session = await openBrowser('studio-workbench');
  try {
    const page = await session.browser.newPage(),
      errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto(
      pathToFileURL(path.join(projectRoot, 'mock/index.html')).href +
        '#view=editor&project=platform&deck=deck1',
      { waitUntil: 'networkidle0' },
    );
    await page.waitForSelector('.editor-grid');
    assert.equal(await page.$('.editor-progress-disclosure'), null);
    await page.evaluate(() => window.scrollTo(0, 500));
    const sticky = await page.evaluate(() => ({
      header: document.querySelector('.app-header').getBoundingClientRect().bottom,
      step: document.querySelector('.studio-progress').getBoundingClientRect().top,
    }));
    assert.ok(Math.abs(sticky.header - sticky.step) < 2);
    for (const name of ['slides', 'inspector']) {
      await page.$eval(`[data-editor-panel="${name}"]`, (n) =>
        n.scrollIntoView({ block: 'center' }),
      );
      await page.click(`[data-editor-panel="${name}"]`);
      assert.equal(await page.$eval(`#editor-${name}`, (n) => n.hidden), true);
      await page.$eval(`[data-editor-panel="${name}"]`, (n) =>
        n.scrollIntoView({ block: 'center' }),
      );
      await page.click(`[data-editor-panel="${name}"]`);
    }
    await page.screenshot({
      path: path.join(projectRoot, 'mock/captures/folio/mock-studio-editor.png'),
    });
    await page.setViewport({ width: 320, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 400));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.equal(
      await page.$$eval(
        '.studio-stepper a',
        (nodes) =>
          nodes.filter((n) => {
            const r = n.getBoundingClientRect();
            return r.left >= 0 && r.right <= innerWidth;
          }).length,
      ),
      6,
    );
    await page.screenshot({
      path: path.join(projectRoot, 'mock/captures/folio/mock-studio-editor-phone.png'),
    });
    assert.deepEqual(errors, []);
    console.log(
      'PASS: direct file mock, sticky progress, independent panels and six visible mobile stages.',
    );
  } finally {
    await session.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
