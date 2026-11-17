// Purpose: Verify Studio review progress, Space processing, and demo role navigation.
// Pattern: Browser journeys through visible controls with owned fixtures and cleanup.
// Usage: node mock/helpers/workspace-flow.cjs; use the shared browser environment.
// Related: mock/js/studio.js, mock/js/space.js, mock/helpers/browser.cjs.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { openBrowser, baseURL, artifacts, projectRoot } = require('./browser.cjs');
(async () => {
  const fixtures = fs.mkdtempSync(path.join(artifacts, 'workspace-flow-'));
  const reference = path.join(fixtures, '테스트 참고.pdf');
  const template = path.join(fixtures, '테스트 디자인.pptx');
  fs.writeFileSync(reference, 'Metadata-only mock fixture. Not a real PDF.');
  fs.writeFileSync(template, 'Metadata-only mock fixture. Not a real PPTX.');
  const { browser, close } = await openBrowser('workspace-flow');
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const snapshot = () => page.evaluate(() => window.PreMMock.snapshot());
  const nav = () =>
    page.$$eval('#global-navigation a', (nodes) => nodes.map((node) => node.textContent));
  const route = async (view, extra = '') => {
    await page.evaluate((hash) => {
      location.hash = hash;
    }, `view=${view}&project=platform${extra}`);
    await page.waitForFunction(
      (view) => document.querySelector('#workspace').dataset.view === view,
      {},
      view,
    );
  };
  const role = async (value) => {
    await page.click('[data-action="account-preview"]');
    await page.click(`[data-role="${value}"]`);
  };
  const fill = async (selector, value) =>
    page.$eval(
      selector,
      (node, value) => {
        node.value = value;
        node.dispatchEvent(new Event('input', { bubbles: true }));
      },
      value,
    );
  try {
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto(baseURL, { waitUntil: 'networkidle0' });
    assert.deepEqual(await nav(), ['Home', 'Studio', 'Space', 'Admin']);
    await role('member');
    assert.deepEqual(await nav(), ['Home', 'Studio', 'Space']);
    await page.evaluate(() => {
      location.hash = 'view=admin';
    });
    await page.waitForFunction(
      () => document.querySelector('#workspace').dataset.view === 'projects',
    );
    assert.equal(await page.$('.admin-layout'), null);
    await role('admin');
    await route('admin');
    assert.deepEqual(
      await page.$$eval('.admin-tabs a', (nodes) => nodes.map((node) => node.textContent.trim())),
      ['AI 연결', '업무별 AI', '작업 현황', '서비스 상태'],
    );
    await route('projects');
    await page.click('#project-create-button');
    await fill('#new-project-name', '단계 확인 프로젝트');
    await fill('#new-project-end-date', '2030-01-31');
    await page.click('#app-dialog button[type="submit"]');
    await page.waitForFunction(
      () => document.querySelector('#workspace').dataset.view === 'documents',
    );
    assert.equal(await page.$$eval('.studio-stepper li', (nodes) => nodes.length), 6);
    const id = (await snapshot()).projects[0].id;
    await page.click('[data-action="confirm-studio-step"]');
    await page.waitForSelector('form[data-form="guide"]');
    assert.ok((await snapshot()).projects[0].studioConfirmed.documents);
    await fill('#guide-do', '수정한 목표');
    await page.click('[data-action="confirm-studio-step"]');
    assert.equal(await page.$eval('#workspace', (node) => node.dataset.view), 'guide');
    assert.match(await page.$eval('#guide-message', (node) => node.textContent), /저장/);
    await page.click('form[data-form="guide"] button[type="submit"]');
    await page.click('[data-action="confirm-studio-step"]');
    await page.waitForFunction(
      () => document.querySelector('#workspace').dataset.view === 'outline',
    );
    assert.ok((await snapshot()).projects[0].studioConfirmed.guide);
    await page.click('.studio-stepper a[href*="view=guide"]');
    await page.waitForSelector('#guide-do');
    await fill('#guide-do', '새 리비전 목표');
    await page.click('form[data-form="guide"] button[type="submit"]');
    assert.match(
      await page.$eval('.studio-stepper a[aria-current="step"]', (node) => node.textContent),
      /변경됨/,
    );
    await route('documents');
    assert.equal(
      (await snapshot()).projects.find((p) => p.id === 'platform').studioConfirmed,
      undefined,
    );
    assert.ok((await snapshot()).projects.find((p) => p.id === id).studioConfirmed.guide);
    await route('space', '&tab=references');
    const originalDocs = (await snapshot()).projects.find((p) => p.id === 'platform').documents
      .length;
    await page.click('[data-action="upload-asset"]');
    await (await page.$('#asset-files')).uploadFile(reference);
    await page.click('#app-dialog button[type="submit"]');
    await page.waitForSelector('[data-action="asset-toggle"]');
    await page.click('[data-action="asset-toggle"]');
    let asset = (await snapshot()).spaceAssets[0];
    assert.equal(asset.status, 'paused');
    const pausedStep = asset.step;
    await new Promise((resolve) => setTimeout(resolve, 1350));
    assert.equal((await snapshot()).spaceAssets[0].step, pausedStep);
    await page.click('[data-action="asset-toggle"]');
    await page.waitForFunction(() => window.PreMMock.snapshot().spaceAssets[0].step >= 1);
    await page.click('[data-action="asset-cancel"]');
    assert.equal((await snapshot()).spaceAssets[0].status, 'cancelled');
    await page.click('[data-action="asset-toggle"]');
    await page.waitForFunction(
      () => window.PreMMock.snapshot().spaceAssets[0].status === 'completed',
    );
    assert.equal((await snapshot()).spaceAssets[0].step, 3);
    assert.equal(
      (await snapshot()).projects.find((p) => p.id === 'platform').documents.length,
      originalDocs,
    );
    await route('space', '&tab=templates');
    await page.click('[data-action="upload-asset"]');
    await (await page.$('#asset-files')).uploadFile(reference);
    await page.click('#app-dialog button[type="submit"]');
    assert.equal(await page.$eval('#asset-files', (node) => node.validity.valid), false);
    assert.equal((await snapshot()).spaceAssets.length, 1);
    await (await page.$('#asset-files')).uploadFile(template);
    await page.click('#app-dialog button[type="submit"]');
    await page.waitForSelector('[data-action="asset-toggle"]');
    await page.waitForFunction(() => window.PreMMock.snapshot().spaceAssets[0].step >= 1);
    await page.click('[data-action="asset-toggle"]');
    const captures = path.join(projectRoot, 'mock/captures/folio');
    await page.screenshot({
      path: path.join(captures, 'space-processing-desktop.png'),
      fullPage: true,
    });
    for (const width of [390, 320]) {
      await page.setViewport({ width, height: 844 });
      for (const view of ['projects', 'documents', 'space', 'admin']) {
        await route(view);
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
          true,
        );
        assert.deepEqual(await nav(), ['Home', 'Studio', 'Space', 'Admin']);
        assert.equal(
          await page.$$eval('#global-navigation a', (links) =>
            links.every((link) => {
              const r = link.getBoundingClientRect();
              return [r.left + 2, r.right - 2].every((x) =>
                link.contains(document.elementFromPoint(x, r.top + r.height / 2)),
              );
            }),
          ),
          true,
          'Navigation labels must not be covered by account controls',
        );
      }
    }
    await route('space', '&tab=templates');
    await page.screenshot({
      path: path.join(captures, 'space-processing-phone.png'),
      fullPage: true,
    });
    await role('member');
    assert.deepEqual(await nav(), ['Home', 'Studio', 'Space']);
    await page.screenshot({ path: path.join(captures, 'space-member-phone.png'), fullPage: true });
    await page.goto(pathToFileURL(path.join(projectRoot, 'mock/index.html')).href + '#view=space', {
      waitUntil: 'networkidle0',
    });
    await page.reload({ waitUntil: 'networkidle0' });
    assert.equal(await page.$eval('#main-title', (node) => node.textContent), 'Space');
    assert.equal((await snapshot()).spaceAssets.length, 0);
    assert.deepEqual(errors, []);
    const result = {
      globalNavigation: true,
      demoRoleGuard: true,
      uploadEntersStudio: true,
      revisionAwareSteps: true,
      unsavedGuideGuard: true,
      projectIsolation: true,
      assetPauseCancelRetry: true,
      templateTypeValidation: true,
      spaceProjectSeparation: true,
      mobileOverflow: false,
      directFileOpening: true,
      refreshResets: true,
      pageErrors: errors,
    };
    fs.writeFileSync(
      path.join(artifacts, 'workspace-flow-report.json'),
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result));
  } finally {
    await close();
    fs.rmSync(fixtures, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
