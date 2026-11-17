// Purpose: Verify project context actions target the right record and clean up safely.
// Pattern: Browser interactions with isolated in-memory state, fallback and keyboard paths.
// Usage: node mock/helpers/project-menu.cjs with the shared browser tool configuration.
// Related: mock/js/project-menu.js, mock/js/project-management.js, mock/helpers/browser.cjs.
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { openBrowser, baseURL, projectRoot } = require('./browser.cjs');
(async () => {
  const { browser, close } = await openBrowser('project-menu');
  try {
    const p = await browser.newPage(),
      errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    await p.setViewport({ width: 1440, height: 1000 });
    await p.goto(baseURL + '#view=projects', { waitUntil: 'networkidle0' });
    const state = () => p.evaluate(() => PreMMock.snapshot());
    const original = await state(),
      target = original.projects.find((item) => item.id !== 'platform');
    const trigger = `[data-project-menu-trigger="${target.id}"]`,
      popup = `#project-menu-${target.id}`;
    await p.click(`[data-project-row="${target.id}"] h2`, { button: 'right' });
    await p.waitForSelector(`${popup}:popover-open`);
    await p.screenshot({
      path: projectRoot + '/mock/captures/folio/project-context-menu.png',
      fullPage: true,
    });
    assert.equal(await p.$eval(trigger, (n) => n.getAttribute('aria-expanded')), 'true');
    await p.click(`${popup} [data-action="rename-project"]`);
    await p.waitForSelector('#app-dialog[open] #rename-project-name');
    assert.equal(await p.$eval('#rename-project-name', (n) => n.value), target.name);
    await p.$eval('#rename-project-name', (n) => {
      n.focus();
      n.select();
    });
    await p.keyboard.type('  프로젝트 이름 변경 확인  ');
    await p.click('#app-dialog button[type="submit"]');
    const renamed = await state();
    assert.equal(renamed.projects.find((x) => x.id === target.id).name, '프로젝트 이름 변경 확인');
    assert.deepEqual(
      renamed.projects.find((x) => x.id === 'platform'),
      original.projects.find((x) => x.id === 'platform'),
    );
    await p.focus(trigger);
    await p.keyboard.press('ArrowDown');
    await p.waitForFunction(
      (selector) => document.activeElement?.matches(selector),
      {},
      `${popup} [data-action="new-project"]`,
    );
    await p.keyboard.press('ArrowDown');
    await p.keyboard.press('ArrowDown');
    assert.equal(
      await p.$eval(`${popup} [data-action="clone-project"]`, (n) => document.activeElement === n),
      true,
    );
    await p.keyboard.press('End');
    assert.equal(
      await p.$eval(`${popup} [data-action="delete-project"]`, (n) => document.activeElement === n),
      true,
    );
    await p.keyboard.press('Escape');
    assert.equal(await p.$eval(trigger, (n) => document.activeElement === n), true);
    await p.keyboard.down('Shift');
    await p.keyboard.press('F10');
    await p.keyboard.up('Shift');
    await p.waitForSelector(`${popup}:popover-open`);
    await p.click(`${popup} [data-action="delete-project"]`);
    await p.waitForSelector('#app-dialog[open]');
    assert.equal(
      await p.$eval('#app-dialog [autofocus]', (n) => document.activeElement === n),
      true,
    );
    await p.keyboard.press('Escape');
    assert.equal((await state()).projects.length, 3);
    await p.click(trigger);
    await p.click(`${popup} [data-action="delete-project"]`);
    await p.click('#app-dialog [data-action="confirm-delete-project"]');
    assert.equal(
      (await state()).projects.some((x) => x.id === target.id),
      false,
    );
    // Pointer toggle and outside dismissal must preserve the invoked row's controls.
    const remaining = (await state()).projects[0].id;
    const more = `[data-project-menu-trigger="${remaining}"]`;
    await p.click(more);
    await p.click(more);
    await p.waitForFunction(() => !document.querySelector('.project-context-menu:popover-open'));
    await p.click(more);
    await p.click('#main-title');
    await p.waitForFunction(() => !document.querySelector('.project-context-menu:popover-open'));
    await p.setViewport({ width: 390, height: 844 });
    await p.click(more);
    const bounds = await p.$eval('.project-context-menu:popover-open', (n) => {
      const r = n.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    });
    assert.ok(bounds.left >= 0 && bounds.right <= 390 && bounds.top >= 0 && bounds.bottom <= 844);
    await p.screenshot({
      path: projectRoot + '/mock/captures/folio/project-context-menu-phone.png',
      fullPage: true,
    });
    await p.keyboard.press('Escape');
    await p.click('[data-action="filter-projects"][data-value="all"]');
    for (const item of (await state()).projects) {
      await p.click(`[data-project-menu-trigger="${item.id}"]`);
      await p.click(`#project-menu-${item.id} [data-action="delete-project"]`);
      await p.click('#app-dialog [data-action="confirm-delete-project"]');
    }
    assert.equal((await state()).projects.length, 0);
    await p.evaluate(() => {
      location.hash = 'view=documents';
    });
    await p.waitForFunction(() => document.querySelector('#workspace').dataset.view === 'projects');
    await p.click('#project-create-button');
    await p.type('#new-project-name', '다시 시작');
    await p.$eval('#new-project-end-date', (n) => {
      n.value = '2030-01-31';
      n.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await p.click('#app-dialog button[type="submit"]');
    await p.waitForFunction(() => PreMMock.snapshot().projects.length === 1);
    // No-native-popover path also works through direct file opening.
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
    await fallback.click('[data-project-menu-trigger]');
    await fallback.waitForSelector('.project-context-menu:not([hidden])');
    await fallback.keyboard.press('ArrowDown');
    await fallback.keyboard.press('ArrowDown');
    await fallback.keyboard.press('ArrowDown');
    assert.equal(
      await fallback.evaluate(() => document.activeElement.dataset.action),
      'clone-project',
    );
    await fallback.keyboard.press('Escape');
    assert.equal(
      await fallback.$eval('[data-project-menu-trigger]', (n) => document.activeElement === n),
      true,
    );
    assert.deepEqual(errors, []);
    console.log(
      'PASS: right-click/overflow, target-specific rename/delete, cancellation, keyboard, mobile, last-project recovery, file opening and fallback.',
    );
  } finally {
    await close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
