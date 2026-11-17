// Purpose: Verify Home gallery controls against the real server in browser E2E.
// Pattern: UI mutations, persisted HTTP assertions and narrow viewport captures.
// Usage: Called by projects.cjs with its isolated server and browser ownership.
// Related: frontend/src/features/projects/, tests/helpers/browser.cjs.
const { setViewport } = require('../helpers/interactions.cjs');
const assert = require('node:assert/strict');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { checkFiltersAndFallbacks } = require('./home-fallbacks.cjs');
async function setDate(page, value = '2030-01-15') {
  await page.$eval(
    '.project-dialog input[name=due_date]',
    (node, date) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(node, date);
      node.dispatchEvent(new Event('input', { bubbles: true }));
      node.dispatchEvent(new Event('change', { bubbles: true }));
    },
    value,
  );
}
async function openAction(page, label) {
  await page.click('.project-card footer > button');
  await page.waitForSelector('.project-menu[data-state="open"]');
  await page.$$eval(
    '.project-menu[data-state="open"] [role="menuitem"]',
    (nodes, text) => nodes.find((n) => n.textContent.trim() === text).click(),
    label,
  );
  await page.waitForSelector('.project-dialog');
}
async function submit(page) {
  await page.click('.project-dialog .dialog-actions > :last-child');
  await page.waitForSelector('.project-dialog', { hidden: true });
}
async function homeChecks(page, base, captures) {
  await setViewport(page, { width: 1440, height: 1000 });
  await page.goto(base + '/home', { waitUntil: 'networkidle0' });
  for (let i = 1; i <= 6; i++) {
    const response = await fetch(base + '/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({ name: `팀 프로젝트 ${i}`, due_date: `2030-02-0${i}` }),
    });
    assert.equal(response.status, 201);
  }
  await page.reload({ waitUntil: 'networkidle0' });
  assert.equal(await page.$$eval('.project-card', (nodes) => nodes.length), 6);
  assert.equal(
    await page.$eval(
      '.project-gallery',
      (node) => getComputedStyle(node).gridTemplateColumns.split(' ').length,
    ),
    3,
  );
  assert.equal(await page.$('.project-create-fab'), null);
  assert.ok(await page.$eval('#project-create-button', (n) => !!n.closest('.projects-heading')));

  await setViewport(page, { width: 1440, height: 1000 });
  await page.screenshot({ path: path.join(captures, 'home-production.png'), fullPage: false });
  await setViewport(page, { width: 390, height: 844 });
  await page.screenshot({ path: path.join(captures, 'home-production-phone.png') });
  await setViewport(page, { width: 1440, height: 1000 });
  await page.$$eval('.projects-pagination button', (nodes) =>
    nodes.find((n) => n.textContent.includes('다음')).click(),
  );
  await page.waitForFunction(() => document.querySelectorAll('.project-card').length === 2);
  await openAction(page, '보관');
  await submit(page);
  await page.waitForFunction(() => document.querySelectorAll('.project-card').length === 1);
  await page.$$eval('.filter-field', (nodes) =>
    nodes
      .find((n) => n.querySelector('label')?.textContent === '상태')
      .querySelector('[role=combobox]')
      .click(),
  );
  await page.waitForSelector('[role=option]');
  await page.$$eval('[role=option]', (nodes) =>
    nodes.find((n) => n.textContent === '보관됨').click(),
  );
  await page.click('.project-filters button[type=submit]');
  await page.waitForFunction(() =>
    document.querySelector('.project-card-status')?.textContent.includes('보관됨'),
  );
  await openAction(page, '복원');
  await submit(page);
  await page.waitForSelector('.projects-empty');
  await page.goto(base + '/home', { waitUntil: 'networkidle0' });
  await openAction(page, '프로젝트 정보 복사');
  assert.equal(
    await page.$eval('.project-dialog input[name=due_date]', (node) => !!node.value),
    true,
  );
  await submit(page);
  await page.waitForFunction(() => location.pathname.includes('/studio/'));
  await page.goto(base + '/home', { waitUntil: 'networkidle0' });
  await page.waitForFunction(() =>
    document.querySelector('.project-card h2')?.textContent.includes('사본'),
  );
  // Context menu and keyboard actions target the current card.
  await page.click('.project-card h2', { button: 'right' });
  await page.waitForSelector('.project-menu[data-state="open"]');
  await page.waitForFunction(() => document.activeElement.closest('.project-menu'));
  await page.keyboard.press('End');
  await page.waitForFunction(() => document.activeElement.textContent.trim() === '삭제');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.project-dialog');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.project-dialog', { hidden: true });
  await openAction(page, '삭제');
  await submit(page);
  await page.waitForFunction(
    () => !document.querySelector('.project-card h2')?.textContent.includes('사본'),
  );
  const records = await (await fetch(base + '/api/v1/projects?status=all')).json();
  assert.equal(records.total, 8);
  // Background right-click and keyboard open the same creation flow.
  await page.click('h1', { button: 'right' });
  await page.waitForSelector('.project-menu[data-state="open"]');
  await page.waitForFunction(() => document.activeElement.closest('.project-menu'));
  assert.equal(
    await page.$$eval(
      '.project-menu[data-state="open"] [role="menuitem"]',
      (nodes) => nodes.length,
    ),
    1,
  );
  if (await page.evaluate(() => document.activeElement.getAttribute('role') === 'menu'))
    await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.project-dialog');
  await page.type('.project-dialog input[name=name]', '달력 선택 검사');
  await page.click('.project-dialog .dialog-actions > :last-child');
  assert.equal(
    await page.$eval('.project-dialog input[name=due_date]', (node) => node.validity.valueMissing),
    true,
  );
  await setDate(page);
  // Exercise the actual shadcn Calendar, including its keyboard day movement.
  await page.click('.project-dialog button[aria-label="마감일 달력 열기"]');
  await page.waitForSelector('[data-slot=calendar]');
  await page.waitForFunction(() => document.activeElement.closest('[data-slot=calendar]'));
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.due-date-calendar', { hidden: true });
  assert.equal(
    await page.$eval('.project-dialog input[name=due_date]', (node) => node.value),
    '2030-01-16',
  );
  await page.screenshot({
    path: path.join(captures, 'home-create-production.png'),
    fullPage: false,
  });
  await page.keyboard.press('Escape');
  await page.waitForSelector('.project-dialog', { hidden: true });
  await page.waitForFunction(
    () =>
      document.activeElement !== document.body &&
      !document.activeElement.closest('.project-dialog'),
  );
  await page.$eval('h1', (n) => n.focus());
  await page.keyboard.down('Shift');
  await page.keyboard.press('F10');
  await page.keyboard.up('Shift');
  await page.waitForSelector('.project-menu[data-state="open"]');
  await page.waitForFunction(() => document.activeElement.closest('.project-menu'));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.activeElement.tagName === 'H1');
  for (const [width, columns] of [
    [1024, 2],
    [768, 2],
    [390, 1],
    [320, 1],
  ]) {
    await setViewport(page, { width, height: 900 });
    assert.equal(
      await page.$eval(
        '.project-gallery',
        (n) => getComputedStyle(n).gridTemplateColumns.split(' ').length,
      ),
      columns,
    );
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  }
  await checkFiltersAndFallbacks(page, base);
  console.log(
    'PASS: Home 3/2/1 gallery, 6-item pagination, archive/restore, metadata copy, logical delete, card/background menus, required shadcn calendar and header creation command.',
  );
}
module.exports = { homeChecks, setDate, openAction };
