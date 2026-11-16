// Purpose: Verify header creation and background/card menus share the required project creation form.
// Pattern: Browser input journeys with mobile positioning and native/fallback menus.
// Usage: node mock/helpers/project-create.cjs with shared browser tool configuration.
// Related: mock/js/project-menu.js, mock/js/views/projects.js, mock/styles/project-gallery.css.
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { openBrowser, baseURL, projectRoot } = require('./browser.cjs');
(async () => {
  const { browser, close } = await openBrowser('project-create');
  try {
    const p = await browser.newPage(),
      errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    await p.setViewport({ width: 1440, height: 1000 });
    await p.goto(baseURL + '#view=projects', { waitUntil: 'networkidle0' });
    assert.ok(await p.$('.heading-actions [data-action="new-project"]'));
    assert.equal(await p.$('.project-create-fab'), null);
    const position = () =>
      p.$eval('#project-create-button', (n) => {
        const r = n.getBoundingClientRect();
        return {
          right: innerWidth - r.right,
          bottom: innerHeight - r.bottom,
          height: r.height,
          width: r.width,
        };
      });
    assert.ok((await position()).height >= 44);
    await p.click('#project-create-button');
    await p.waitForSelector('#app-dialog[open] #new-project-name');
    assert.equal(await p.$eval('#new-project-end-date', (n) => n.required), true);
    await p.keyboard.press('Escape');
    assert.equal(
      await p.$eval('#project-create-button', (n) => n === document.activeElement),
      true,
    );
    const gap = await p.$eval('.project-gallery', (n) => {
      const r = n.getBoundingClientRect();
      return { x: r.right - 6, y: r.top + 20 };
    });
    await p.mouse.click(gap.x, gap.y, { button: 'right' });
    await p.waitForSelector('#project-background-menu:popover-open');
    assert.equal(await p.$$eval('#project-background-menu button', (n) => n.length), 1);
    await p.screenshot({ path: projectRoot + '/mock/captures/folio/project-create-button.png' });
    await p.click('#project-background-menu [data-action="new-project"]');
    await p.waitForSelector('#app-dialog[open] #new-project-end-date');
    await p.keyboard.press('Escape');
    await p.focus('#main-title');
    await p.keyboard.down('Shift');
    await p.keyboard.press('F10');
    await p.keyboard.up('Shift');
    await p.waitForFunction(() =>
      document.activeElement?.matches('#project-background-menu button'),
    );
    await p.keyboard.press('Enter');
    await p.waitForSelector('#app-dialog[open] #new-project-name');
    await p.keyboard.press('Escape');
    const id = await p.$eval('[data-project-menu-trigger]', (n) => n.dataset.projectMenuTrigger);
    await p.click(`[data-project-row="${id}"] h2`, { button: 'right' });
    await p.click(`#project-menu-${id} [data-action="new-project"]`);
    await p.waitForSelector('#app-dialog[open]');
    assert.equal(await p.$eval('#new-project-name', (n) => n.value), '');
    await p.keyboard.press('Escape');
    await p.click('#search-input', { button: 'right' });
    assert.equal(await p.$('#project-background-menu:popover-open'), null);
    await p.keyboard.press('Escape');
    await p.type('#search-input', '일치하지않는검색');
    await p.click('[data-form="project-filter"] button[type="submit"]');
    await p.waitForSelector('.empty-state');
    await p.click('.empty-state h2', { button: 'right' });
    await p.click('#project-background-menu [data-action="new-project"]');
    await p.waitForSelector('#app-dialog[open]');
    await p.type('#new-project-name', '빈 목록에서 만든 프로젝트');
    await p.$eval('#new-project-end-date', (n) => {
      n.value = '2030-01-31';
      n.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await p.click('#app-dialog button[type="submit"]');
    await p.waitForFunction(() => PuPuTyXMock.snapshot().projects.length === 4);
    await p.evaluate(() => {
      location.hash = 'view=projects';
    });
    await p.waitForSelector('#project-create-button');
    for (const width of [390, 320]) {
      await p.setViewport({ width, height: 844 });
      await p.evaluate(() => scrollTo(0, 0));
      const mobile = await position();
      assert.ok(mobile.width < width - 24 && mobile.height >= 44);
      assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      if (width === 390)
        await p.screenshot({
          path: projectRoot + '/mock/captures/folio/project-create-button-phone.png',
        });
      await p.click('#project-create-button');
      await p.waitForSelector('#app-dialog[open]');
      await p.keyboard.press('Escape');
    }
    const fallback = await browser.newPage();
    fallback.on('pageerror', (e) => errors.push(e.message));
    await fallback.evaluateOnNewDocument(() => {
      delete HTMLElement.prototype.showPopover;
      delete HTMLElement.prototype.hidePopover;
      delete HTMLElement.prototype.focusGroup;
    });
    await fallback.goto(pathToFileURL(projectRoot + '/mock/index.html').href + '#view=projects', {
      waitUntil: 'networkidle0',
    });
    await fallback.click('#main-title', { button: 'right' });
    await fallback.waitForSelector('#project-background-menu:not([hidden])');
    await fallback.keyboard.press('Enter');
    await fallback.waitForSelector('#app-dialog[open] #new-project-end-date');
    assert.deepEqual(errors, []);
    console.log(
      'PASS: header creation command, common creation form, background/card/keyboard menus, empty results, input context, mobile, fallback and direct file opening.',
    );
  } finally {
    await close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
