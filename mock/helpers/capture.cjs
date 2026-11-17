// Purpose: Capture and verify every light mock screen on desktop and mobile.
// Pattern: Browser rendering against a shared screen inventory.
// Usage: node mock/helpers/capture.cjs; see mock/helpers/README.md.
// Related: mock/helpers/browser.cjs, screens.cjs, mock/captures/folio/.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { openBrowser, projectRoot, artifacts, baseURL } = require('./browser.cjs');
const screens = require('./screens.cjs');
const inspectTheme = require('./theme-check.cjs');
const output = path.join(projectRoot, 'mock/captures/folio');
const sizes = [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'phone', width: 390, height: 844 },
];
const stable = async (page) => {
  await page.waitForFunction(() => !!window.PreMMock && !!document.querySelector('#main-title'));
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
};
(async () => {
  fs.mkdirSync(path.join(output, 'screens'), { recursive: true });
  const { browser, close } = await openBrowser('capture');
  const page = await browser.newPage();
  const errors = [],
    findings = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('requestfailed', (request) =>
    errors.push(request.url() + ': ' + request.failure()?.errorText),
  );
  try {
    for (const size of sizes) {
      await page.setViewport({ width: size.width, height: size.height, deviceScaleFactor: 1 });
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
      for (const screen of screens) {
        await page.goto(new URL(screen.hash, baseURL).href, { waitUntil: 'networkidle0' });
        await stable(page);
        const result = await page.evaluate(() => ({
          theme: getComputedStyle(document.documentElement).colorScheme,
          width: innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          title: document.querySelector('#main-title').textContent,
          unnamedTables: [...document.querySelectorAll('.table-scroll')].filter(
            (node) =>
              node.tabIndex !== 0 ||
              node.getAttribute('role') !== 'region' ||
              !node.getAttribute('aria-labelledby'),
          ).length,
        }));
        assert.equal(
          result.theme,
          'light',
          screen.title + ': theme must stay light under an OS dark preference',
        );
        assert.ok(
          result.scrollWidth <= result.width + 1,
          screen.title + ': horizontal root overflow',
        );
        assert.equal(result.unnamedTables, 0, screen.title + ': unnamed table region');
        // Record the resting screen; keyboard focus is exercised by the journey tests.
        await page.evaluate(() => {
          if (document.activeElement?.id === 'main-title') document.activeElement.blur();
        });
        const filename = 'PreM--' + screen.slug + '-' + size.name + '.png';
        if (screen.hash.startsWith('#view=documents')) {
          await page.screenshot({
            path: path.join(output, 'document-gallery-' + size.name + '.png'),
          });
        }
        await page.screenshot({ path: path.join(output, 'screens', filename), fullPage: true });
        findings.push({ screen: screen.title, size: size.name, ...result, filename });
      }
    }
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto(new URL('#view=editor&project=platform&deck=deck1', baseURL).href, {
      waitUntil: 'networkidle0',
    });
    await stable(page);
    const themeChecks = await inspectTheme(page);
    const { contrasts } = themeChecks;
    await page.type('#edit-instruction', '제목을 ‘원본에서 이어지는 프레젠테이션’으로 바꿔줘');
    await page.click('form[data-form="chat"] button[type="submit"]');
    await page.waitForSelector('[data-chat-apply]');
    await stable(page);
    await page.screenshot({ path: path.join(output, 'revision-comparison.png') });
    await page.click('[data-chat-discard]');
    await page.goto(new URL('#view=presentations&project=platform', baseURL).href, {
      waitUntil: 'networkidle0',
    });
    await page.click('.heading-actions [data-action="generate"]');
    await page.waitForSelector('#app-dialog[open]');
    await stable(page);
    await page.screenshot({ path: path.join(output, 'generation-dialog.png') });
    assert.deepEqual(errors, []);
    fs.mkdirSync(artifacts, { recursive: true });
    fs.writeFileSync(
      path.join(artifacts, 'visual-report.json'),
      JSON.stringify({ findings, contrasts, themeChecks, pageErrors: errors }, null, 2),
    );
    const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
    const lines = [
      '# PreM Folio captures',
      '',
      date +
        ' / current Folio app: Home, Studio review stepper, Space processing, and Admin preview; light only.',
      '',
      'Desktop: 1440px wide. Phone: 390px wide. Full page screenshots preserve scrollable page content; internal editor panels retain their visible viewport.',
      '',
      '| Screen | Desktop | Phone |',
      '| --- | --- | --- |',
    ];
    for (const screen of screens) {
      const stem = 'screens/PreM--' + screen.slug;
      lines.push(
        '| ' +
          screen.title +
          ' | [PNG](' +
          stem +
          '-desktop.png) | [PNG](' +
          stem +
          '-phone.png) |',
      );
    }
    lines.push(
      '',
      '[Generation dialog](generation-dialog.png) / [Revision comparison](revision-comparison.png)',
      '',
      'All screens remain light when the browser is emulating a dark OS preference.',
      '',
      '[Document gallery viewport: desktop](document-gallery-desktop.png) / [phone](document-gallery-phone.png)',
      '',
      'Offscreen gallery previews remain placeholders until approached. Full-page images record this initial lazy state.',
      '',
    );
    fs.writeFileSync(path.join(output, 'README.md'), lines.join('\n'));
    console.log(
      JSON.stringify(
        {
          screens: screens.length,
          screenshots: findings.length + 2,
          pageErrors: errors.length,
          contrasts,
          output,
        },
        null,
        2,
      ),
    );
  } finally {
    await close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
