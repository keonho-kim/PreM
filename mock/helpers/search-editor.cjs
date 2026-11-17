// Purpose: Verify contextual editor references, tab drafts, and search highlighting.
// Pattern: Behavioral browser journeys with isolated state and screenshot evidence.
// Usage: node mock/helpers/search-editor.cjs.
// Related: mock/js/editor-support.js, mock/js/asset-search.js, mock/helpers/browser.cjs.
const { openBrowser, baseURL, projectRoot, artifacts } = require('./browser.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  const { browser, close } = await openBrowser('search-editor');
  try {
    const page = await browser.newPage(),
      errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto(baseURL + '#view=references&project=platform', { waitUntil: 'networkidle0' });
    await page.type('#search-input', '근거');
    await page.click('form[data-form="search"] button');
    assert.ok(await page.evaluate(() => CSS.highlights.get('prem-search').size > 0));
    await page.screenshot({
      path: projectRoot + '/mock/captures/folio/search-matches.png',
      fullPage: true,
    });
    await page.type('#search-input', '<img src=x>');
    await page.click('form[data-form="search"] button');
    assert.equal(await page.$('.search-results img'), null);
    await page.evaluate(() => (location.hash = 'view=editor&project=platform&deck=deck1'));
    await page.waitForSelector('#edit-instruction');
    assert.equal(await page.evaluate(() => CSS.highlights.has('prem-search')), false);
    await page.type('#edit-instruction', '보존할 수정 지시');
    await page.focus('#editor-chat-tab');
    await page.keyboard.press('ArrowRight');
    assert.equal(
      await page.$eval('#editor-references-tab', (n) => n.getAttribute('aria-selected')),
      'true',
    );
    await page.click('#editor-chat-tab');
    assert.equal(await page.$eval('#edit-instruction', (n) => n.value), '보존할 수정 지시');
    await page.click('#editor-references-tab');
    const candidates = () =>
      page.$$eval('[data-action="attach-page-reference"]', (nodes) =>
        nodes.map((n) => n.dataset.id),
      );
    const first = await candidates();
    assert.ok(first.length);
    await page.click('[data-action="attach-page-reference"]');
    const snap = await page.evaluate(() => PreMMock.snapshot().projects[0].decks[0]);
    assert.equal(snap.slides[0].sourceInsertions.length, 1);
    assert.equal(snap.version, 2);
    assert.equal(snap.revisions[0].slides[0].sourceInsertions, undefined);
    await page.screenshot({
      path: projectRoot + '/mock/captures/folio/editor-reference-desktop.png',
      fullPage: true,
    });
    await page.click('[data-action="slide-next"]');
    assert.notDeepEqual(await candidates(), first);
    assert.equal(
      await page.evaluate(
        () => PreMMock.snapshot().projects[0].decks[0].slides[1].sourceInsertions,
      ),
      undefined,
    );
    for (const width of [390, 320]) {
      await page.setViewport({ width, height: 844 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      if (width === 390)
        await page.screenshot({
          path: projectRoot + '/mock/captures/folio/editor-reference-phone.png',
          fullPage: true,
        });
    }
    const fallback = await browser.newPage();
    await fallback.evaluateOnNewDocument(() =>
      Object.defineProperty(CSS, 'highlights', { value: undefined }),
    );
    await fallback.goto(baseURL + '#view=references&project=platform', {
      waitUntil: 'networkidle0',
    });
    await fallback.type('#search-input', '원본');
    await fallback.click('form[data-form="search"] button');
    assert.ok(await fallback.$$eval('mark.search-match', (n) => n.length > 0));
    assert.deepEqual(errors, []);
    const report = {
      searchHighlight: true,
      highlightCleanup: true,
      markFallback: true,
      safeQuery: true,
      keyboardTabs: true,
      tabDraftPreserved: true,
      slideScopedCandidates: true,
      immutableAttachment: true,
      mobileOverflow: false,
      errors,
    };
    fs.writeFileSync(artifacts + '/search-editor-report.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally {
    await close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
