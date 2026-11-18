// Purpose: Verify mobile work-panel anchoring and access to the final workspace action.
// Pattern: Real upload UI and isolated server; viewport captures reflect the visible phone screen.
// Usage: Run after pnpm build; PANEL_BEFORE=1 records the previous geometry without assertions.
// Related: app/feedback.tsx, features/space/upload-work-panel.css, studio.cjs.
const { setViewport, settleLayout } = require('../helpers/interactions.cjs');
const assert = require('node:assert/strict');
const path = require('node:path');
const { openBrowser, projectRoot } = require('../helpers/browser.cjs');
const { createServer } = require('./server.cjs');
const { configureDocuments } = require('./configure-documents.cjs');
(async () => {
  const server = await createServer('mobile-work-panel-');
  let session, fixture;
  try {
    await server.start();
    fixture = await configureDocuments(server.base);
    const created = await fetch(server.base + '/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ name: '모바일 원본 작업', due_date: '2030-01-01' }),
    });
    assert.equal(created.status, 201);
    const project = await created.json();
    session = await openBrowser('mobile-work-panel');
    const page = await session.browser.newPage();
    await setViewport(page, { width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.goto(`${server.base}/home/studio/${project.id}`, { waitUntil: 'networkidle0' });
    await (await page.waitForSelector('.studio-upload input[type=file]')).uploadFile(
      path.join(projectRoot, 'tests/fixtures/documents/text.pdf'),
    );
    await page.waitForSelector('.work-dock');
    await page.click('[aria-label="작업 패널 펼치기"]');
    await page.waitForSelector('.studio-source-card');
    await page.waitForFunction(() => !document.querySelector('.studio-review button').disabled, {
      timeout: 90000,
    });
    await page.mouse.move(0, 0);
    await page.waitForFunction(() => !document.querySelector('[data-sonner-toast]'), {
      timeout: 10000,
    });
    const geometry = () =>
      page.evaluate(() => {
        const panel = document.querySelector('.work-dock').getBoundingClientRect();
        const button = document.querySelector('.studio-review button').getBoundingClientRect();
        return {
          left: panel.left,
          right: panel.right,
          bottom: panel.bottom,
          top: panel.top,
          buttonBottom: button.bottom,
          w: innerWidth,
          h: innerHeight,
          scrollWidth: document.documentElement.scrollWidth,
        };
      });
    if (process.env.PANEL_BEFORE) {
      await page.screenshot({
        path: path.join(
          projectRoot,
          'tests/.artifacts/captures/folio/upload-panel-mobile-before.png',
        ),
        fullPage: false,
      });
      await page.$eval('.studio-review button', (n) => n.scrollIntoView({ block: 'end' }));
      console.log('Before:', await geometry());
      return;
    }
    for (const width of [390, 320]) {
      await setViewport(page, { width, height: 844, isMobile: true, hasTouch: true });
      for (const state of ['expanded', 'collapsed', 'hidden']) {
        if (state === 'collapsed') await page.click('[aria-label="작업 패널 접기"]');
        if (state === 'hidden') await page.click('[aria-label="작업 패널 닫기"]');
        await settleLayout(page);
        await page.$eval('.studio-review button', (n) => n.scrollIntoView({ block: 'end' }));
        await page.waitForFunction(() => {
          const panel = document.querySelector('.work-dock').getBoundingClientRect();
          return (
            document.querySelector('.studio-review button').getBoundingClientRect().bottom <=
            panel.top
          );
        });
        const r = await geometry();
        assert.ok(r.scrollWidth <= r.w + 1);
        assert.ok(
          Math.abs(r.left) <= 1 && Math.abs(r.right - r.w) <= 1 && Math.abs(r.bottom - r.h) <= 1,
          JSON.stringify(r),
        );
        await page.screenshot({
          path: path.join(
            projectRoot,
            `tests/.artifacts/captures/folio/upload-panel-mobile-${width}-${state}.png`,
          ),
          fullPage: false,
        });
      }
      await page.click('.work-launcher');
    }
    await setViewport(page, { width: 390, height: 430, isMobile: true, hasTouch: true });
    const compact = await geometry();
    assert.ok(compact.top >= 100 && compact.bottom <= compact.h + 1);
    await setViewport(page, { width: 1440, height: 1000, isMobile: true, hasTouch: true });
    const desktop = await geometry();
    assert.ok(
      Math.abs(desktop.right - (desktop.w - 16)) <= 1 && desktop.right - desktop.left <= 360,
    );
    assert.equal(await page.$eval('body', (n) => getComputedStyle(n).paddingBottom), '0px');
    console.log(
      'PASS: mobile edge dock, expanded/collapsed/launcher, reachable final action, 320/390 widths, short viewport and unchanged desktop anchor.',
    );
  } finally {
    if (session) await session.close();
    await server.close();
    if (fixture) await fixture.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
