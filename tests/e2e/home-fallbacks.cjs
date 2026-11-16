// Purpose: Verify single deadline filters and shadcn overlays and date-only browser fallback in real Chromium.
// Pattern: Public UI interactions with feature APIs disabled before a separate document load.
// Usage: Called by home-checks.cjs against its isolated application instance.
// Related: project-filters.tsx, project-menu-behavior.ts, calendar.ts.
const assert = require('node:assert/strict');
async function checkFiltersAndFallbacks(page, base) {
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(base + '/home', { waitUntil: 'networkidle0' });
  const ratios = await page.evaluate(() => {
    const luminance = (color) => {
      const channels = color
        .match(/[\d.]+/g)
        .slice(0, 3)
        .map(Number)
        .map((v) => v / 255)
        .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    return [
      '.project-card-preview span',
      '.project-card h2',
      '.project-card dt',
      '.project-filters label',
      '#project-create-button',
    ].map((selector) => {
      const element = document.querySelector(selector);
      let plane = element,
        background = getComputedStyle(plane).backgroundColor;
      while (background === 'rgba(0, 0, 0, 0)' && plane.parentElement) {
        plane = plane.parentElement;
        background = getComputedStyle(plane).backgroundColor;
      }
      const a = luminance(getComputedStyle(element).color),
        b = luminance(background);
      return [selector, (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)];
    });
  });
  for (const [selector, ratio] of ratios) assert.ok(ratio >= 4.5, `${selector} contrast ${ratio}`);
  await page.type('.project-filters input[type=search]', '팀 프로젝트');
  const fillDue = async (value) => {
    await page.$eval('.project-filters input[name=due_date]', (input) => {
      input.focus();
      input.select();
    });
    await page.keyboard.type(value);
  };
  assert.equal(
    await page.$$eval('.project-filters input[name=due_date]', (nodes) => nodes.length),
    1,
  );
  await fillDue('2030-02-03');
  await page.click('.project-filters button[type=submit]');
  await page.waitForFunction(() => document.querySelectorAll('.project-card').length === 1);
  assert.match(page.url(), /due_date=2030-02-03/);
  assert.match(await page.$eval('.project-card h2', (n) => n.textContent), /팀 프로젝트 3/);
  await fillDue('2030-02-04');
  await page.click('.project-filters button[type=submit]');
  await page.waitForFunction(() =>
    document.querySelector('.project-card h2')?.textContent.includes('팀 프로젝트 4'),
  );
  await page.goBack({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() =>
    document.querySelector('.project-card h2')?.textContent.includes('팀 프로젝트 3'),
  );
  const trigger = '.project-card footer > button';
  await page.focus(trigger);
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(() => document.activeElement.getAttribute('role') === 'menuitem');
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(() => document.activeElement.textContent.trim() === '이름 바꾸기');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.activeElement.matches('[data-project-menu-trigger]'));
  await page.click(trigger);
  await page.waitForFunction(() => document.querySelector('[aria-expanded=true]'));
  await page.click(trigger);
  await page.waitForSelector('.project-menu[data-state="open"]', { hidden: true });
  // Shadcn menus work without native Popover, focusgroup or invoker APIs.
  const script = await page.evaluateOnNewDocument(() => {
    for (const name of ['showPopover', 'hidePopover', 'togglePopover', 'focusGroup'])
      delete HTMLElement.prototype[name];
    delete HTMLButtonElement.prototype.commandForElement;
    delete globalThis.Temporal;
  });
  try {
    await page.goto(base + '/home', { waitUntil: 'networkidle0' });
    await page.click(trigger);
    await page.waitForSelector('.project-menu[data-state="open"]');
    await page.keyboard.press('ArrowDown');
    await page.waitForFunction(() => document.activeElement.getAttribute('role') === 'menuitem');
    await page.keyboard.press('End');
    await page.waitForFunction(() => document.activeElement.textContent.trim() === '삭제');
    assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), '삭제');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.project-menu[data-state="open"]', { hidden: true });
    await page.waitForFunction(() => document.activeElement.matches('[data-project-menu-trigger]'));
    await page.setViewport({ width: 390, height: 844 });
    await page.click('.project-card h2', { button: 'right' });
    await page.waitForSelector('.project-menu[data-state="open"]', { visible: true });
    const rect = await page.$eval('.project-menu[data-state="open"]', (n) => {
      const r = n.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    });
    assert.ok(
      rect.left >= 0 && rect.right <= 390 && rect.top >= 0 && rect.bottom <= 844,
      JSON.stringify(rect),
    );
    await page.keyboard.press('Escape');
    assert.match(await page.$eval('.deadline', (n) => n.textContent), /^D[-+]/);
    for (const timezone of ['Asia/Seoul', 'America/Los_Angeles']) {
      await page.emulateTimezone(timezone);
      await page.click('#project-create-button');
      await page.waitForSelector('.project-dialog');
      await page.type('.project-dialog input[name=due_date]', '2030-01-15');
      await page.click('.project-dialog button[aria-label="마감일 달력 열기"]');
      await page.waitForFunction(() => document.activeElement.closest('[data-slot=calendar]'));
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('Enter');
      await page.waitForSelector('.due-date-calendar', { hidden: true });
      assert.equal(
        await page.$eval('.project-dialog input[name=due_date]', (n) => n.value),
        '2030-01-16',
      );
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.activeElement.id === 'project-create-button');
    }
  } finally {
    await page.removeScriptToEvaluateOnNewDocument(script.identifier);
  }
  console.log(
    'PASS: single due-date filtering, URL back, overflow keyboard/pointer behavior and shadcn menus without native Popover and date fallback.',
  );
}
module.exports = { checkFiltersAndFallbacks };
