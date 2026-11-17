// Purpose: Verify the mock's existing end-to-end state and revision contracts.
// Pattern: Browser journey assertions using isolated helper artifacts.
// Usage: node mock/helpers/smoke.cjs; see mock/helpers/README.md.
// Related: mock/helpers/browser.cjs, mock/app.js, mock/js/.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const { openBrowser, projectRoot, artifacts, baseURL } = require('./browser.cjs');

(async () => {
  const qa = artifacts;
  fs.mkdirSync(qa, { recursive: true });
  const downloads = path.join(qa, 'downloads');
  fs.mkdirSync(downloads, { recursive: true });
  fs.rmSync(path.join(downloads, 'PreM-mock-presentation.json'), { force: true });
  fs.copyFileSync(
    path.join(__dirname, 'fixtures/선택한-원본.pdf'),
    path.join(qa, '선택한-원본.pdf'),
  );
  const { browser, close } = await openBrowser('smoke');
  const page = await browser.newPage();
  const errors = [],
    backendRequests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('requestfailed', (request) =>
    errors.push(request.url() + ': ' + request.failure()?.errorText),
  );
  page.on('request', (request) => {
    if (
      request.method() !== 'GET' ||
      ['fetch', 'xhr', 'websocket'].includes(request.resourceType()) ||
      (request.url().startsWith('http') &&
        new URL(request.url()).origin !== new URL(baseURL).origin)
    )
      backendRequests.push(request.url());
  });
  const state = () => page.evaluate(() => window.PreMMock.snapshot());
  const fill = async (selector, value) => {
    await page.$eval(selector, (element) => {
      element.value = '';
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.type(selector, value);
  };
  const go = async (view, extra = '') => {
    await page.goto(new URL('#view=' + view + '&project=platform' + extra, baseURL).href, {
      waitUntil: 'networkidle0',
    });
    await page.waitForFunction(() => !!window.PreMMock);
    await page.waitForSelector('#main-title');
  };
  const navigate = async (view, extra = '') => {
    await page.evaluate(
      (hash) => {
        location.hash = hash;
      },
      'view=' + view + '&project=platform' + extra,
    );
    await page.waitForFunction(
      (value) =>
        new URLSearchParams(location.hash.slice(1)).get('view') === value &&
        document.querySelector('#main-title'),
      {},
      view,
    );
    await new Promise((resolve) => setTimeout(resolve, 60));
  };
  try {
    await page.setViewport({ width: 1440, height: 1000 });
    await go('overview');
    assert.equal((await state()).projects.length, 3);
    const upload = '.heading-actions button[data-action="upload"]';
    await page.focus(upload);
    await page.keyboard.press('Enter');
    await page.waitForSelector('#app-dialog[open] #upload-files');
    assert.equal(await page.$eval('#dialog-title', (node) => node.textContent), '원본 문서 추가');
    assert.equal(new URL(page.url()).hash, '#view=overview&project=platform');
    await page.keyboard.press('Escape');
    assert.equal(await page.$eval(upload, (node) => node === document.activeElement), true);
    await page.click('[data-action="switch-project"]');
    await page.click('#app-dialog a[href*="project=knowledge"]');
    await page.waitForFunction(
      () => document.querySelector('#main-title')?.textContent === '신입사원 온보딩 안내',
    );
    await page.click('[data-action="switch-project"]');
    await page.click('#app-dialog a[href*="project=platform"]');
    await page.waitForFunction(
      () => document.querySelector('#main-title')?.textContent === '분기 업무 보고',
    );

    for (const view of [
      'projects',
      'documents',
      'guide',
      'outline',
      'references',
      'templates',
      'presentations',
      'editor',
      'history',
      'admin',
    ])
      await navigate(view, view === 'editor' ? '&deck=deck1' : '');
    await navigate('guide');
    await fill('#guide-do', '<img src=x onerror="window.__mockXss=1">');
    await page.click('#guide-form button[type="submit"]');
    await page.waitForFunction(() =>
      document.querySelector('#guide-message')?.textContent.includes('작성 방향을 저장했습니다'),
    );
    let snapshot = await state();
    assert.equal(snapshot.projects[0].guides.at(-1).version, 3);
    assert.equal(snapshot.projects[0].decks[0].guideVersion, 1);
    assert.equal(snapshot.projects[0].decks[0].version, 1);
    assert.equal(snapshot.projects[0].outlineVersion, 1);
    assert.equal(await page.evaluate(() => window.__mockXss), undefined);
    assert.equal(await page.$$eval('img', (nodes) => nodes.length), 0);

    await navigate('outline');
    await page.click('[data-action="add-outline"]');
    await page.waitForSelector('#app-dialog[open]');
    await fill('#outline-name', '추가한 목차');
    await page.click('#app-dialog button[type="submit"]');
    assert.equal((await state()).projects[0].outlines.length, 6);
    await page.click('[data-action="map-block"]');
    await page.click('input[name="block"][value="b1"]');
    await page.click('#app-dialog button[type="submit"]');
    snapshot = await state();
    assert.deepEqual(snapshot.projects[0].outlines.at(-1).blockIds, ['b1']);
    assert.deepEqual(snapshot.projects[0].outlines[0].blockIds, ['b1']);
    assert.equal(snapshot.projects[0].decks[0].outlineVersion, 1);

    await navigate('documents');
    await page.click('[data-action="upload"]');
    await (await page.$('#upload-files')).uploadFile(path.join(qa, '선택한-원본.pdf'));
    await page.click('#app-dialog button[type="submit"]');
    const doc = (await state()).projects[0].documents.at(-1);
    assert.equal(doc.name, '선택한-원본.pdf');
    assert.equal(doc.status, 'registered');
    assert.equal(doc.sample, false);

    await navigate('templates');
    await page.click('[data-action="select-template"][data-id="briefing"]');
    assert.equal((await state()).projects[0].template, 'briefing');
    assert.equal((await state()).projects[0].decks[0].template, 'standard');
    await navigate('presentations');
    await page.click('.heading-actions [data-action="generate"]');
    await fill('#deck-title', '목업 검증 발표');
    await fill('#slide-count', '3');
    await page.click('#app-dialog button[type="submit"]');
    await page.waitForSelector('[data-action="toggle-run"]');
    await page.click('[data-action="toggle-run"]');
    const pausedStep = (await state()).runs.at(-1).step;
    await new Promise((resolve) => setTimeout(resolve, 850));
    assert.equal((await state()).runs.at(-1).step, pausedStep);
    await page.click('[data-action="toggle-run"]');
    await page.waitForFunction(
      () => window.PreMMock.snapshot().runs.at(-1).status === 'completed',
      { timeout: 12000 },
    );
    snapshot = await state();
    const created = snapshot.projects[0].decks[0];
    assert.equal(created.slides.length, 3);
    assert.equal(created.guideVersion, 3);
    assert.equal(created.template, 'briefing');
    // Acknowledge the completed work panel before editing the result it was covering.
    await page.click('[data-task-clear]');
    for (const closeToast of await page.$$('.mock-toast button')) await closeToast.click();
    await navigate('editor', '&deck=' + created.id);
    assert.equal(
      await page.$eval('.editor-stage .slide-sheet', (element) =>
        element.classList.contains('briefing'),
      ),
      true,
    );
    await fill('#edit-instruction', '제목을 ‘목업 수정안 적용’으로 바꿔줘');
    await page.click('form[data-form="chat"] button[type="submit"]');
    await page.waitForSelector('[data-chat-apply]');
    assert.equal((await state()).projects[0].decks[0].slides[0].title, created.slides[0].title);
    await page.click('[data-chat-apply]');
    assert.equal((await state()).projects[0].decks[0].slides[0].title, '목업 수정안 적용');
    assert.equal((await state()).projects[0].decks[0].version, 2);
    await page.click('[data-action="deck-revisions"]');
    await page.click('[data-action="restore-deck"][data-version="1"]');
    assert.equal((await state()).projects[0].decks[0].slides[0].title, created.slides[0].title);
    assert.equal((await state()).projects[0].decks[0].version, 3);
    const client = await page.target().createCDPSession();
    await client.send('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: downloads,
      eventsEnabled: true,
    });
    const completedDownload = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        client.off('Browser.downloadProgress', listener);
        reject(new Error('JSON download did not complete'));
      }, 5000);
      const listener = (event) => {
        if (event.state !== 'completed') return;
        clearTimeout(timeout);
        client.off('Browser.downloadProgress', listener);
        resolve();
      };
      client.on('Browser.downloadProgress', listener);
    });
    await page.click('.heading-actions [data-action="export"]');
    await page.click('[data-action="download-json"]');
    await completedDownload;
    const exportedPath = path.join(downloads, 'PreM-mock-presentation.json');
    const exported = JSON.parse(fs.readFileSync(exportedPath, 'utf8'));
    assert.equal(exported.mock, true);
    assert.equal(exported.version, 3);
    assert.equal(exported.slides.length, 3);

    await navigate('admin');
    await page.click('[data-action="new-provider"]');
    await fill('#provider-name', '샘플 Provider');
    await page.click('.office-connection-details summary');
    await fill('#provider-key', 'not-a-real-key');
    await page.click('#app-dialog button[type="submit"]');
    assert.equal(JSON.stringify(await state()).includes('not-a-real-key'), false);
    assert.equal(await page.$eval('#provider-key', (element) => element.value), '');
    await page.click('[data-action="test-provider"]');
    assert.equal((await state()).providers[0].tested, true);
    await page.setViewport({ width: 375, height: 812 });
    await navigate('overview');
    await page.focus('[data-action="switch-project"]');
    await page.keyboard.press('Enter');
    assert.equal(await page.$eval('#app-dialog', (element) => element.open), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.$eval('#app-dialog', (element) => element.open), false);
    assert.equal(
      await page.$eval(
        '[data-action="switch-project"]',
        (element) => document.activeElement === element,
      ),
      true,
    );
    assert.equal(await page.$('.sidebar'), null);
    await page.click('.studio-stepper a[href*="view=documents"]');
    await page.waitForSelector('[data-page-preview]');
    await page.setViewport({ width: 1440, height: 1000 });
    await navigate('projects');
    await page.click('#project-create-button');
    await fill('#new-project-name', '<img src=x onerror="window.__mockXss=2">');
    await page.$eval('#new-project-end-date', (n) => {
      n.value = '2030-01-31';
      n.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.click('#app-dialog button[type="submit"]');
    await page.waitForFunction(() => window.PreMMock.snapshot().projects.length === 4);
    assert.equal((await state()).projects[0].documents.length, 1);
    assert.equal(await page.evaluate(() => window.__mockXss), undefined);
    assert.equal(await page.$$eval('img', (nodes) => nodes.length), 0);
    await navigate('projects');
    const originalId = (await state()).projects[0].id;
    await page.click('[data-project-menu-trigger="' + originalId + '"]');
    await page.click('[data-action="clone-project"][data-id="' + originalId + '"]');
    assert.equal((await state()).projects.length, 5);
    const copyId = (await state()).projects[0].id;
    await page.click('[data-project-menu-trigger="' + copyId + '"]');
    await page.click('[data-action="archive-project"][data-id="' + copyId + '"]');
    assert.equal((await state()).projects[0].status, 'archived');
    await page.click('[data-action="filter-projects"][data-value="archived"]');
    await page.click('[data-project-menu-trigger="' + copyId + '"]');
    await page.click('[data-action="archive-project"][data-id="' + copyId + '"]');
    assert.equal((await state()).projects[0].status, 'active');
    await navigate('documents');
    assert.equal(await page.$('.state-demo'), null, 'QA controls stay outside the user journey');
    await navigate('admin', '&tab=system');
    await page.click('[data-action="reset-confirm"]');
    await page.click('[data-action="reset"]');
    await page.waitForFunction(() => window.PreMMock.snapshot().projects.length === 3);
    await navigate('editor', '&deck=deck1');
    await page.click('.editor-stage [data-edit-field="title"]');
    await page.$eval('.editor-stage [data-edit-field="title"]', (node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    });
    await page.keyboard.type('속성 편집 확인');
    await page.keyboard.down('Control');
    await page.keyboard.press('Enter');
    await page.keyboard.up('Control');
    assert.equal((await state()).projects[0].decks[0].slides[0].title, '속성 편집 확인');
    assert.equal((await state()).projects[0].decks[0].version, 2);
    await page.goto(pathToFileURL(path.join(projectRoot, 'mock/index.html')).href, {
      waitUntil: 'networkidle0',
    });
    assert.equal((await state()).projects.length, 3);
    assert.deepEqual(errors, []);
    assert.deepEqual(backendRequests, []);
    const result = {
      navigation: true,
      overviewUploadAction: true,
      projectSwitching: true,
      directCanvasText: true,
      guideVersionIsolation: true,
      sharedBlockMapping: true,
      fileMetadataOnly: true,
      templateSelection: true,
      generationPauseResume: true,
      editCompareApplyRestore: true,
      jsonExport: true,
      apiKeyNotRetained: true,
      mobileDialogFocus: true,
      fileProtocol: true,
      backendRequests: backendRequests.length,
      pageErrors: errors.length,
    };
    fs.writeFileSync(path.join(qa, 'smoke-result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } finally {
    await close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
