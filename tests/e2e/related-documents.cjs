// Purpose: Verify native relationship search, grouped projects, safe highlighting and pinned selections.
// Pattern: Two browsers, actual product server and a controlled native model; viewport captures are QA only.
// Usage: Run after pnpm build; no application data or real model configuration is changed.
// Related: related-fixture.cjs, backend/tests/related_documents.rs.
const assert = require('node:assert/strict');
const path = require('node:path');
const { openBrowser, projectRoot } = require('../helpers/browser.cjs');
const { createServer } = require('./server.cjs');
const { model, json, seed, upload, ready } = require('./related-fixture.cjs');
async function click(page, name, role = 'button') {
  await (
    await page.waitForSelector(`::-p-aria(${name}[role="${role}"])`, { visible: true })
  ).click();
}
async function capture(page, name) {
  await page.screenshot({
    path: path.join(projectRoot, 'tests/.artifacts/captures/folio', name),
    fullPage: (page.viewport()?.width ?? 1440) > 640,
  });
}
(async () => {
  const server = await createServer('related-documents-browser-');
  const fixture = await model();
  let session;
  try {
    await server.start();
    const { target, original } = await seed(server.base, fixture.base);
    session = await openBrowser('related-documents');
    const a = await (await session.browser.createBrowserContext()).newPage(),
      b = await (await session.browser.createBrowserContext()).newPage();
    const errors = [];
    for (const p of [a, b]) p.on('pageerror', (e) => errors.push(e.message));
    await a.setViewport({ width: 1440, height: 1000 });
    const route = `${server.base}/home/studio/${target.id}?step=related`;
    await a.goto(route, { waitUntil: 'networkidle0' });
    await a.waitForFunction(() => !document.querySelector('#related-query').disabled);
    assert.equal(new URL(a.url()).searchParams.get('step'), 'evidence');
    assert.equal(await a.$('.studio-related-entry'), null);
    assert.equal(
      await a.$eval('button[aria-label="근거"]', (n) => n.getAttribute('aria-current')),
      'step',
    );
    await a.$eval('#related-query', (node) => {
      node.focus();
      node.select();
    });
    await a.keyboard.press('Backspace');
    await a.type('#related-query', 'efficiency');
    assert.equal(fixture.state.calls, 0);
    await click(a, '관련 자료 찾기');
    await a.waitForFunction(() => new URL(location.href).searchParams.has('search'));
    const first = new URL(a.url()).searchParams.get('search');
    assert.ok(first);
    await a.waitForFunction(
      () =>
        document.querySelector('.related-progress')?.textContent.includes('개 후보를 확인했습니다'),
      { timeout: 60000 },
    );
    await a.waitForSelector('.related-result');
    await capture(a, 'related-documents-desktop.png');
    assert.ok(await a.evaluate(() => CSS.highlights?.get('document-search-matches')?.size > 0));
    const result = await json(
      server.base,
      `/api/v1/projects/${target.id}/related-searches/${first}/results?kind=file`,
    );
    const grouped = result.items.find((i) => i.origin_count === 2);
    assert.ok(grouped);
    await click(a, '소속 2곳 보기');
    await a.waitForSelector('.related-origins');
    assert.equal(await a.$$eval('.related-origins li', (n) => n.length), 2);
    await capture(a, 'related-document-projects.png');
    await a.keyboard.press('Escape');
    await a.waitForSelector('[role=dialog]', { hidden: true });
    await a.click(`[data-candidate-id="${grouped.id}"] .related-select`);
    await a.waitForFunction(
      (id) =>
        document
          .querySelector(`[data-candidate-id="${id}"] .related-select`)
          ?.getAttribute('aria-pressed') === 'true',
      {},
      grouped.id,
    );
    await b.goto(`${route}&search=${first}`, { waitUntil: 'networkidle0' });
    await click(b, '선택한 근거', 'tab');
    await b.waitForSelector('.evidence-tabs > [role=tabpanel][data-state=active] .related-result');
    assert.equal(
      await b.$$eval(
        '.evidence-tabs > [role=tabpanel][data-state=active] .related-result',
        (n) => n.length,
      ),
      1,
    );
    const calls = fixture.state.calls;
    await a.$eval('#related-query', (node) => {
      node.focus();
      node.select();
    });
    await a.keyboard.press('Backspace');
    await a.type('#related-query', 'efficiency');
    await click(a, '관련 자료 찾기');
    await a.waitForFunction(
      (id) => new URL(location.href).searchParams.get('search') !== id,
      {},
      first,
    );
    await a.waitForFunction(() =>
      document.querySelector('.related-progress')?.textContent.includes('개 후보를 확인했습니다'),
    );
    assert.equal(fixture.state.calls, calls);
    await click(a, '내용', 'tab');
    await a.waitForSelector('.evidence-tabs > [role=tabpanel][data-state=active] .related-result');
    await a.click('[data-state=active] .related-thumbnail');
    await a.waitForSelector('.processing-dialog');
    await a.waitForSelector('.processing-block');
    assert.equal(
      await a.$eval('.processing-tabs [data-state=active][role=tab]', (n) => n.textContent),
      '내용',
    );
    await a.keyboard.press('Escape');
    await a.waitForSelector('.processing-dialog', { hidden: true });
    const source = grouped.origins[0];
    const replacement = await upload(
      server.base,
      source.project_id,
      source.filename,
      '<!DOCTYPE html><html><body><p>REPLACEMENT text with new assumptions.</p></body></html>',
      source,
    );
    await ready(server.base, source.project_id, replacement);
    await click(a, '선택한 근거', 'tab');
    await a.waitForSelector('.evidence-tabs > [role=tabpanel][data-state=active] .related-result');
    await capture(a, 'related-documents-selected.png');
    const selected = await json(server.base, `/api/v1/projects/${target.id}/related-items`);
    assert.equal(selected.items[0].origins[0].file_version, 1);
    const old = await fetch(
      `${server.base}/api/v1/projects/${source.project_id}/files/${source.item_id}/download?version=1`,
    );
    assert.equal(await old.text(), original);
    await a.setViewport({ width: 390, height: 844 });
    await capture(a, 'related-documents-phone.png');
    for (const width of [390, 320]) {
      await a.setViewport({ width, height: 844 });
      assert.ok(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    }
    await a.evaluateOnNewDocument(() => {
      Object.defineProperty(CSS, 'highlights', { value: undefined, configurable: true });
    });
    await a.goto(`${route}&search=${first}`, { waitUntil: 'networkidle0' });
    await click(a, '내용', 'tab');
    await a.waitForSelector('.related-excerpt mark');
    assert.ok(
      await a.$$eval('.related-excerpt mark', (n) =>
        n.every((v) => v.textContent.toLowerCase() === 'efficiency'),
      ),
    );
    await server.stop();
    await server.start();
    await b.reload({ waitUntil: 'networkidle0' });
    await click(b, '선택한 근거', 'tab');
    await b.waitForSelector('.evidence-tabs > [role=tabpanel][data-state=active] .related-result');
    assert.equal((await json(server.base, `/api/v1/projects/${target.id}/related-items`)).total, 1);
    assert.deepEqual(errors, []);
    console.log(
      'PASS: native Decision search, explicit start/settings, grouped source projects, shared pinned selections, zero-call repeat, exact-version/page preview, native/fallback highlighting, mobile and restart.',
    );
  } finally {
    if (session) await session.close();
    await server.close();
    await fixture.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
