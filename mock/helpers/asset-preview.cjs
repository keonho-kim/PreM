// Purpose: Verify the mock's visual asset previews and honest metadata-only upload behavior.
// Pattern: Real browser over file and HTTP, isolated sample files and explicit cleanup.
// Usage: PUPUTYX_BROWSER_TOOLS=... node mock/helpers/asset-preview.cjs; static mock server on 5174.
// Related: mock/js/asset-preview.js, space.js, mock/captures/folio/.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { openBrowser, projectRoot } = require('./browser.cjs');
(async () => {
  const session = await openBrowser('asset-preview');
  const root = fs.mkdtempSync(path.join(projectRoot, 'mock/helpers/.artifacts/asset-preview-'));
  const file = path.join(root, '팀 소개 <샘플>.pptx');
  fs.writeFileSync(file, 'Metadata only. This is not a PowerPoint document.');
  const captures = path.join(projectRoot, 'mock/captures/folio');
  const errors = [];
  try {
    for (const base of [
      pathToFileURL(projectRoot + '/mock/index.html').href,
      'http://127.0.0.1:5174/',
    ]) {
      const page = await session.browser.newPage();
      page.on('pageerror', (error) => errors.push(error.message));
      await page.evaluateOnNewDocument(() => {
        File.prototype.text =
          File.prototype.arrayBuffer =
          File.prototype.stream =
            () => {
              throw new Error('Mock must not read uploaded bytes');
            };
      });
      await page.setViewport({ width: 1440, height: 1000 });
      await page.goto(base + '#view=space&tab=templates', { waitUntil: 'networkidle0' });
      const snapshot = await page.evaluate(() =>
        JSON.stringify(window.PuPuTyXMock.snapshot().projects),
      );
      const opener = '[data-action="asset-preview"][data-id="library-standard"]';
      await page.click(opener);
      await page.waitForSelector('#app-dialog[open] .asset-preview');
      assert.equal(await page.$eval('[data-preview-position]', (n) => n.textContent), '1 / 6');
      assert.equal(await page.$eval('[data-action="preview-previous"]', (n) => n.disabled), true);
      assert.doesNotMatch(
        await page.$eval('#dialog-content', (n) => n.textContent),
        /체크포인트|슬롯|검증|네이티브|판정|번들/,
      );
      await page.click('[data-action="preview-next"]');
      assert.equal(await page.$eval('[data-preview-position]', (n) => n.textContent), '2 / 6');
      await page.click('[data-action="preview-slide"][data-index="5"]');
      assert.equal(await page.$eval('[data-action="preview-next"]', (n) => n.disabled), true);
      await page.click('[data-action="preview-slide"][data-index="0"]');
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      await page.screenshot({
        path: path.join(captures, 'mock-template-preview.png'),
        fullPage: true,
      });
      for (const width of [390, 320]) {
        await page.setViewport({ width, height: 844 });
        assert.ok(await page.$eval('#app-dialog', (n) => n.scrollWidth <= n.clientWidth + 1));
        assert.ok(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        );
      }
      await page.setViewport({ width: 390, height: 844 });
      await page.screenshot({
        path: path.join(captures, 'mock-template-preview-phone.png'),
        fullPage: true,
      });
      await page.keyboard.press('Escape');
      await page.waitForSelector('#app-dialog:not([open])');
      assert.equal(await page.$eval(opener, (n) => n === document.activeElement), true);
      assert.equal(
        await page.evaluate(() => JSON.stringify(window.PuPuTyXMock.snapshot().projects)),
        snapshot,
      );
      await page.setViewport({ width: 1440, height: 1000 });
      await page.click('[data-action="upload-asset"]');
      await (await page.$('#asset-files')).uploadFile(file);
      await page.click('[data-form="space-upload"] button[type="submit"]');
      await page.waitForFunction(
        () => document.querySelector('[data-asset-status]')?.textContent === '템플릿 준비 완료',
      );
      await page.click(
        '[data-asset-id]:not([data-asset-id^="library-"]) [data-action="asset-preview"]',
      );
      await page.waitForSelector('.asset-preview');
      assert.match(
        await page.$eval('.asset-preview-caption', (n) => n.textContent),
        /업로드한 파일의 내용이 아닙니다/,
      );
      assert.equal(await page.$eval('#dialog-title', (n) => n.textContent), '팀 소개 <샘플>.pptx');
      await page.keyboard.press('Escape');
      await page.goto(base + '#view=templates&project=platform', { waitUntil: 'networkidle0' });
      await page.click('[data-action="template-layouts"][data-id="briefing"]');
      assert.equal(await page.$eval('[data-preview-position]', (n) => n.textContent), '1 / 4');
      await page.click('[data-action="close-dialog"]');
      await page.goto(base + '#view=space&tab=references', { waitUntil: 'networkidle0' });
      await page.click('[data-action="asset-preview"][data-id="library-r1"]');
      assert.ok(
        (await page.$eval('.asset-reference-preview', (n) => n.textContent)).includes('샘플 자료'),
      );
      await page.close();
    }
    assert.deepEqual(errors, []);
    console.log(
      'PASS: mock file/HTTP template previews, thumbnails, keyboard focus return, mobile, Studio reuse, references and metadata-only uploads.',
    );
  } finally {
    await session.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
