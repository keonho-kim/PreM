// Purpose: Verify real extracted images and merged table cells in the product viewer.
// Pattern: Synthetic DOCX through the real upload/worker/storage path and a passive browser view.
// Usage: Run after pnpm build; all data is isolated and screenshots remain in tests/.artifacts/captures.
// Related: parsing-quality/merged-report.docx, document-structure.mjs, extracted-table.tsx.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { createServer } = require('./server.cjs');
const { configureDocuments } = require('./configure-documents.cjs');
const { openBrowser, projectRoot } = require('../helpers/browser.cjs');
(async () => {
  const server = await createServer('structure-browser-');
  let session, fixture;
  try {
    await server.start();
    fixture = await configureDocuments(server.base);
    const form = new FormData();
    form.set(
      'file',
      new Blob([
        fs.readFileSync(
          path.join(projectRoot, 'tests/fixtures/parsing-quality/merged-report.docx'),
        ),
      ]),
      '분기 보고.docx',
    );
    form.set('title', '분기 보고');
    form.set('tags', '[]');
    const item = await (
      await fetch(server.base + '/api/v1/space/references', {
        method: 'POST',
        headers: { 'Idempotency-Key': randomUUID() },
        body: form,
      })
    ).json();
    let ready = false;
    for (let i = 0; i < 600; i++) {
      const d = await (
        await fetch(`${server.base}/api/v1/space/references/${item.id}/processing`)
      ).json();
      if (d.job?.status === 'succeeded') {
        ready = true;
        break;
      }
      assert.notEqual(d.job?.status, 'failed');
      await delay(100);
    }
    assert.ok(ready);
    session = await openBrowser('source-structure');
    const page = await session.browser.newPage();
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto(server.base + '/home/space/library', { waitUntil: 'networkidle0' });
    await page.click('.space-title-button');
    await page.waitForSelector('.extracted-table');
    assert.equal(await page.$eval('.extracted-table th', (node) => node.colSpan), 3);
    await (await page.waitForSelector('.processing-block img')).evaluate((node) =>
      node.scrollIntoView({ block: 'center' }),
    );
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.processing-block img')].some(
        (i) => i.complete && i.naturalWidth > 0,
      ),
    );
    await page.screenshot({
      path: path.join(projectRoot, 'tests/.artifacts/captures/folio/extracted-table-images.png'),
      fullPage: true,
    });
    await page.setViewport({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    const region = await page.waitForSelector('[aria-label="원문 표 스크롤"]');
    await region.focus();
    assert.equal(
      await page.evaluate(() => document.activeElement.getAttribute('aria-label')),
      '원문 표 스크롤',
    );
    console.log(
      'PASS: canonical image Blob is rendered, merged header spans three cells, table region is keyboard-focusable and mobile does not overflow.',
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
