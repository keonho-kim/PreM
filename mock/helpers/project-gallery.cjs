// Purpose: Verify project calendar dates, deadline cards and filtered pagination.
// Pattern: Real forms and native date-picker keyboard interaction in isolated browser state.
// Usage: node mock/helpers/project-gallery.cjs with the shared browser tool configuration.
// Related: mock/js/project-gallery.js, mock/js/project-dates.js, mock/helpers/browser.cjs.
const assert = require('node:assert/strict');
const { openBrowser, baseURL, projectRoot } = require('./browser.cjs');
(async () => {
  const { browser, close } = await openBrowser('project-gallery');
  try {
    const p = await browser.newPage(),
      errors = [];
    p.on('pageerror', (error) => errors.push(error.message));
    await p.setViewport({ width: 1440, height: 1100 });
    await p.goto(baseURL + '#view=projects', { waitUntil: 'networkidle0' });
    const state = () => p.evaluate(() => PreMMock.snapshot());
    const dateValue = (selector, value) =>
      p.$eval(
        selector,
        (n, v) => {
          n.value = v;
          n.dispatchEvent(new Event('input', { bubbles: true }));
        },
        value,
      );
    assert.equal(
      await p.$eval(
        '.project-gallery',
        (n) => getComputedStyle(n).gridTemplateColumns.split(' ').length,
      ),
      3,
    );
    await p.click('#project-create-button');
    await p.type('#new-project-name', '일정 검증 프로젝트');
    await p.click('#app-dialog button[type="submit"]');
    assert.equal((await state()).projects.length, 3);
    assert.equal(await p.$eval('#new-project-end-date', (n) => n.validity.valueMissing), true);
    await dateValue('#new-project-end-date', '2030-01-15');
    // Activate the browser's calendar button, then choose the next calendar day.
    const r = await p.$eval('#new-project-end-date', (n) => {
      const b = n.getBoundingClientRect();
      return { x: b.right - 18, y: b.top + b.height / 2 };
    });
    await p.mouse.click(r.x, r.y);
    await p.keyboard.press('ArrowRight');
    await p.keyboard.press('Enter');
    assert.equal(await p.$eval('#new-project-end-date', (n) => n.value), '2030-01-16');
    await p.screenshot({
      path: projectRoot + '/mock/captures/folio/project-registration-date.png',
      fullPage: true,
    });
    await p.click('#app-dialog button[type="submit"]');
    await p.waitForFunction(() => PreMMock.snapshot().projects.length === 4);
    assert.equal((await state()).projects[0].endDate, '2030-01-16');
    await p.evaluate(() => {
      location.hash = 'view=projects';
    });
    await p.waitForSelector('.project-gallery');
    // Build enough sample records through the real clone command to cross a page boundary.
    for (let i = 0; i < 5; i++) {
      const id = await p.$eval('[data-project-menu-trigger]', (n) => n.dataset.projectMenuTrigger);
      await p.click(`[data-project-menu-trigger="${id}"]`);
      await p.click(`#project-menu-${id} [data-action="clone-project"]`);
      const copied = (await state()).projects[0].id;
      await p.click(`[data-project-menu-trigger="${copied}"]`);
      await p.click(`#project-menu-${copied} [data-action="rename-project"]`);
      await p.$eval(
        '#rename-project-name',
        (n, value) => {
          n.value = value;
          n.dispatchEvent(new Event('input', { bubbles: true }));
        },
        ['사내 지식 서비스', '분기 운영 보고', '고객 지원 가이드', '영업 제안 자료', '문서 표준화'][
          i
        ],
      );
      await p.click('#app-dialog button[type="submit"]');
    }
    assert.equal(await p.$$eval('.project-gallery-card', (n) => n.length), 6);
    assert.match(await p.$eval('.project-gallery-summary', (n) => n.textContent), /8개 프로젝트/);
    await p.click('[data-action="project-page"][data-page="2"]');
    assert.equal(await p.$$eval('.project-gallery-card', (n) => n.length), 2);
    assert.equal(await p.$eval('.project-pagination [aria-current]', (n) => n.textContent), '2');
    await dateValue('#project-date-from', '2030-01-16');
    await dateValue('#project-date-to', '2030-01-16');
    await p.click('form[data-form="project-filter"] button[type="submit"]');
    assert.equal(await p.$eval('.project-pagination [aria-current]', (n) => n.textContent), '1');
    assert.equal(await p.$$eval('.project-gallery-card', (n) => n.length), 6);
    assert.ok(
      await p.$$eval('.project-card-end time', (nodes) =>
        nodes.every((n) => n.dateTime === '2030-01-16'),
      ),
    );
    await dateValue('#project-date-from', '2030-02-01');
    await p.click('form[data-form="project-filter"] button[type="submit"]');
    assert.equal(await p.$eval('#project-date-to', (n) => n.validity.customError), true);
    await dateValue('#project-date-from', '2030-01-16');
    assert.equal(await p.$eval('#project-date-to', (n) => n.validity.customError), false);
    await p.click('[data-action="project-filter-clear"]');
    const example = await p.$eval('.project-gallery-card', (n) => n.textContent);
    for (const label of ['문서', 'PPT', '가이드', '종료일', '최근 수정'])
      assert.ok(example.includes(label));
    await p.screenshot({
      path: projectRoot + '/mock/captures/folio/project-gallery-desktop.png',
      fullPage: true,
    });
    for (const [width, columns] of [
      [1024, 2],
      [768, 2],
      [390, 1],
      [320, 1],
    ]) {
      await p.setViewport({ width, height: 900 });
      assert.equal(
        await p.$eval(
          '.project-gallery',
          (n) => getComputedStyle(n).gridTemplateColumns.split(' ').length,
        ),
        columns,
      );
      assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      if (width === 390)
        await p.screenshot({
          path: projectRoot + '/mock/captures/folio/project-gallery-phone.png',
          fullPage: true,
        });
    }
    // The fallback must agree across a DST transition and reject invalid calendar dates.
    for (const timezone of ['Asia/Seoul', 'America/Los_Angeles']) {
      await p.emulateTimezone(timezone);
      const result = await p.evaluate(() => {
        const dates = PreMModules.projectDates;
        const native = dates.difference('2026-03-09', '2026-03-07');
        const temporal = globalThis.Temporal;
        globalThis.Temporal = undefined;
        const fallback = dates.difference('2026-03-09', '2026-03-07');
        const valid = dates.valid('2026-02-30');
        globalThis.Temporal = temporal;
        return {
          native,
          fallback,
          valid,
          due: dates.deadline(dates.today()).text,
          overdue: dates.deadline(dates.shift(-1)).text,
        };
      });
      assert.deepEqual(result, {
        native: 2,
        fallback: 2,
        valid: false,
        due: 'D-Day',
        overdue: 'D+1',
      });
    }
    assert.deepEqual(errors, []);
    console.log(
      'PASS: required calendar registration, native picker selection, three-column cards, pagination, inclusive end-date filters, invalid ranges, mobile and DST-safe deadlines.',
    );
  } finally {
    await close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
