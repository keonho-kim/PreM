// Purpose: Verify real reference parts and ordered visual review without fabricating PPT generation.
// Pattern: Compiled app, bundled PPT Master/Kordoc, isolated storage and independent browsers.
// Usage: Run after pnpm build; screenshots go to tests/.artifacts/captures/folio and test storage is disposable.
// Related: server.cjs, space-checks.cjs, backend/tests/reference_materials.rs.
const assert = require('node:assert/strict');
const path = require('node:path');
const { createServer } = require('./server.cjs');
const { configureDocuments } = require('./configure-documents.cjs');
const { upload, notifications } = require('./space-checks.cjs');
const { openBrowser, projectRoot } = require('../helpers/browser.cjs');
async function click(page, name, role = 'button') {
  await (
    await page.waitForSelector(`::-p-aria(${name}[role="${role}"])`, { visible: true })
  ).click();
}
async function kind(page, label) {
  await click(page, '자료 종류', 'combobox');
  await click(page, label, 'option');
  await page.waitForFunction(
    (label) => document.querySelector('#material-kind')?.textContent === label,
    {},
    label,
  );
}
async function capture(page, name) {
  await page.mouse.move(0, 0);
  await page.waitForFunction(() => !document.querySelector('[data-sonner-toast]'), {
    timeout: 10000,
  });
  await page.evaluate(async () => {
    document.querySelector('.asset-preview-body')?.scrollTo(0, 0);
    await document.fonts.ready;
  });
  await page.screenshot({
    path: path.join(projectRoot, 'tests/.artifacts/captures/folio', name),
    fullPage: true,
  });
}
(async () => {
  const server = await createServer('reference-materials-browser-');
  let session, fixture;
  try {
    await server.start();
    fixture = await configureDocuments(server.base);
    session = await openBrowser('reference-materials');
    const a = await (await session.browser.createBrowserContext()).newPage();
    const b = await (await session.browser.createBrowserContext()).newPage();
    await a.bringToFront();
    await a.setViewport({ width: 1440, height: 1000 });
    const errors = [];
    for (const p of [a, b]) p.on('pageerror', (e) => errors.push(e.message));
    await a.goto(server.base + '/home/space/library', { waitUntil: 'networkidle0' });
    await a.waitForSelector('.space-empty');
    await upload(
      a,
      [path.join(projectRoot, 'tests/fixtures/documents/reference-materials.pptx')],
      '발표 참고 자료',
    );
    await a.waitForSelector('.space-asset');
    await notifications(a, false);
    await click(a, '발표 참고 자료 미리보기');
    await a.waitForSelector('.material-card', { timeout: 60000 });
    assert.doesNotMatch(
      await a.$eval('.processing-dialog', (n) => n.textContent),
      /shape_ids|native_locator|manifest|PPT Master|체크포인트/,
    );
    assert.deepEqual(
      await a.$$eval('.material-slide-groups .reference-slide > h2', (nodes) =>
        nodes.map((node) => node.textContent),
      ),
      ['슬라이드 1', '슬라이드 2'],
    );
    await click(a, '내용', 'tab');
    await a.waitForSelector('.processing-blocks .reference-slide .processing-block');
    assert.deepEqual(
      await a.$$eval('.processing-blocks .reference-slide > h2', (nodes) =>
        nodes.map((node) => node.textContent),
      ),
      ['슬라이드 1', '슬라이드 2'],
    );
    await click(a, 'PPT에 쓸 자료', 'tab');
    await kind(a, '장표·페이지');
    await a.waitForFunction(() => document.querySelectorAll('.material-card').length === 2);
    const picks = await a.$$('.material-card button[aria-pressed]');
    await picks[1].click();
    await picks[0].click();
    await click(a, '선택한 자료 보기');
    await a.waitForSelector('.material-review');
    const order = await a.$$eval('.material-caption span', (nodes) =>
      nodes.map((n) => n.textContent),
    );
    assert.match(order[0], /슬라이드 2/);
    assert.match(order[1], /슬라이드 1/);
    await a.waitForFunction(() => {
      const img = document.querySelector('.material-review img');
      return img?.complete && img.naturalWidth > 0;
    });
    await capture(a, 'reference-selected-slides.png');
    await click(a, '전체 자료로 돌아가기');
    await kind(a, '그림');
    await a.waitForFunction(() => document.querySelectorAll('.material-card').length >= 4);
    assert.match(await a.$eval('.material-slide-groups', (n) => n.textContent), /이미지/);
    assert.match(await a.$eval('.material-slide-groups', (n) => n.textContent), /도형·도식/);
    assert.match(await a.$eval('.material-slide-groups', (n) => n.textContent), /차트/);
    assert.equal(
      await a.$$eval('.material-image', (nodes) =>
        nodes.every((node) => {
          const bounds = node.getBoundingClientRect();
          return Math.abs(bounds.height - bounds.width * 0.75) < 2;
        }),
      ),
      true,
    );
    await capture(a, 'reference-artwork.png');
    const response = await fetch(server.base + '/api/v1/space/references');
    const listing = await response.json();
    const item = listing.items[0];
    const detail = await (
      await fetch(`${server.base}/api/v1/space/references/${item.id}/processing`)
    ).json();
    const catalogURL = `${server.base}/api/v1/document-jobs/${detail.job.id}/materials`;
    const before = await (await fetch(catalogURL)).json();
    assert.equal(before.file_version, 1);
    assert.ok(before.bundle);
    assert.equal(detail.template, null);
    const templates = await (await fetch(server.base + '/api/v1/space/templates')).json();
    assert.equal(templates.total, 0);
    await b.goto(server.base + '/home/space/library', { waitUntil: 'networkidle0' });
    await click(b, '발표 참고 자료 미리보기');
    await b.waitForSelector('.material-card');
    assert.match(await b.$eval('.material-toolbar', (n) => n.textContent), /0개 선택/);
    await a.bringToFront();
    await a.setViewport({ width: 390, height: 844 });
    await capture(a, 'reference-artwork-phone.png');
    assert.equal(
      await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      true,
    );
    await kind(a, '글·표');
    await a.waitForSelector('.material-text');
    await a.focus('.material-text');
    assert.equal(
      await a.evaluate(() => document.activeElement?.getAttribute('aria-label')?.endsWith('본문')),
      true,
    );
    await server.stop();
    await server.start();
    const after = await (await fetch(catalogURL)).json();
    assert.deepEqual(after, before);
    await b.reload({ waitUntil: 'networkidle0' });
    await click(b, '발표 참고 자료 미리보기');
    await b.waitForSelector('.material-card');
    assert.deepEqual(errors, []);
    console.log(
      'PASS: real source slides/images/charts/grouped diagrams/text, ordered multi-slide review, independent selections, native lineage, lazy images, keyboard/mobile and restart.',
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
