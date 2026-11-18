// Purpose: Verify real Space originals, revisions and shared metadata through compiled React.
// Pattern: Isolated real server, two browser contexts, failure injection and restart checks.
// Usage: pnpm test:e2e after pnpm build; QA files are removed in finally.
// Related: space-checks.cjs, server.cjs, backend/tests/space.rs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { openBrowser, projectRoot } = require('../helpers/browser.cjs');
const { createServer } = require('./server.cjs');
const { htmlChecks } = require('./html-checks.cjs');
const { fixtures, button, action, upload, rename, notifications } = require('./space-checks.cjs');
(async () => {
  const server = await createServer('space-browser-');
  const { base } = server;
  const fixtureRoot = fs.mkdtempSync(path.join(projectRoot, 'tests/.artifacts/space-fixtures-'));
  const file = fixtures(fixtureRoot);
  const captures = path.join(projectRoot, 'tests/.artifacts/captures/folio');
  let session;
  try {
    await server.start();
    session = await openBrowser('space-production');
    const contextA = await session.browser.createBrowserContext();
    const contextB = await session.browser.createBrowserContext();
    const a = await contextA.newPage(),
      b = await contextB.newPage(),
      errors = [];
    for (const page of [a, b]) {
      page.on('pageerror', (error) => errors.push(error.message));
      await page.setViewport({ width: 1440, height: 1000 });
      await page.goto(base + '/home/space/library', { waitUntil: 'networkidle0' });
      await page.waitForSelector('.space-empty');
    }
    await a.screenshot({ path: path.join(captures, 'space-empty-production.png'), fullPage: true });
    await upload(a, [file('팀 운영.docx')], '팀 운영 가이드');
    await a.waitForSelector('.space-asset');
    assert.equal(await a.$('main .space-uploads'), null);
    await notifications(a);
    await a.waitForFunction(() =>
      document.querySelector('.space-upload-row')?.textContent.includes('원본 등록 완료'),
    );
    assert.equal(await a.$('.space-upload-row [aria-label$="전송률"]'), null);
    await a.waitForSelector('[data-sonner-toast][data-mounted="true"]');
    await a.waitForFunction(() => {
      const toast = document.querySelector('[data-sonner-toast]')?.getBoundingClientRect();
      const panel = document.querySelector('.work-dock')?.getBoundingClientRect();
      return (
        toast &&
        panel &&
        toast.bottom <= panel.top &&
        Number(getComputedStyle(document.querySelector('[data-sonner-toast]')).opacity) > 0.99
      );
    });
    // The toast must remain viewport-bound even if the app root establishes a containing block.
    await a.evaluate(() => {
      const root = document.getElementById('root');
      root.style.transform = 'translateZ(0)';
      root.style.minHeight = '2500px';
      window.scrollTo(0, 600);
    });
    assert.equal(
      await a.$eval('[data-sonner-toaster]', (n) => !document.getElementById('root').contains(n)),
      true,
    );
    assert.equal(
      await a.$eval('[data-sonner-toast][data-front="true"]', (n) => {
        const rect = n.getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= innerHeight && rect.right <= innerWidth;
      }),
      true,
    );
    await a.evaluate(() => {
      const root = document.getElementById('root');
      root.style.removeProperty('transform');
      root.style.removeProperty('min-height');
      window.scrollTo(0, 0);
    });
    await a.click('button[aria-label="작업 패널 닫기"]');
    await a.waitForSelector('.work-launcher');
    await notifications(a);
    await a.click('.app-navigation a[href="/home/"]');
    await a.waitForSelector('.model-setup-notice');
    await notifications(a);
    assert.match(await a.$eval('.space-uploads', (n) => n.textContent), /팀 운영.docx/);
    await a.screenshot({
      path: path.join(captures, 'upload-work-panel-setup.png'),
      fullPage: true,
    });
    await notifications(a, false);
    await a.click('.app-navigation a[href="/home/space"]');
    await a.waitForSelector('.space-asset');
    await b.reload({ waitUntil: 'networkidle0' });
    await b.waitForSelector('.space-asset');
    assert.match(await b.$eval('.space-asset', (n) => n.textContent), /팀 운영 가이드/);
    assert.deepEqual(await b.cookies(), []);
    await notifications(b);
    assert.equal(await b.$('.space-upload-row'), null);
    assert.equal(await b.$('.work-dock'), null);
    assert.equal(await b.$('.app-header button[aria-label="업로드 알림"]'), null);
    await notifications(b, false);
    const otherTab = await contextA.newPage();
    await otherTab.goto(base + '/home/space/library', { waitUntil: 'networkidle0' });
    await notifications(otherTab);
    assert.equal(await otherTab.$('.space-upload-row'), null);
    await otherTab.close();
    const listing = await (await fetch(base + '/api/v1/space/references')).json();
    const originalId = listing.items[0].id;
    const download = await fetch(base + `/api/v1/space/references/${originalId}/download`);
    assert.deepEqual(
      Buffer.from(await download.arrayBuffer()),
      fs.readFileSync(file('팀 운영.docx')),
    );
    assert.match(download.headers.get('content-disposition'), /attachment/);
    await action(a, '정보 수정');
    await action(b, '정보 수정');
    await rename(a, '팀 운영 지침');
    await a.waitForSelector('.space-dialog', { hidden: true });
    await rename(b, '검토 완료 운영 지침');
    await b.waitForFunction(
      () => !!document.querySelector('.space-dialog .space-error')?.textContent,
    );
    assert.equal(await b.$eval('.space-dialog input', (n) => n.value), '검토 완료 운영 지침');
    await button(b, '.space-dialog button', '최신 정보 확인');
    await b.waitForFunction(() =>
      document.querySelector('.space-dialog [role="status"]')?.textContent.includes('현재 자료:'),
    );
    await b.click('.space-dialog button[type="submit"]');
    await b.waitForSelector('.space-dialog', { hidden: true });
    await a.reload({ waitUntil: 'networkidle0' });
    await action(a, '새 파일 버전');
    await (await a.$('.space-dialog input[type="file"]')).uploadFile(file('개정 운영.docx'));
    await a.click('.space-dialog button[type="submit"]');
    await a.waitForSelector('.space-dialog', { hidden: true });
    await a.waitForFunction(() =>
      document.querySelector('.space-asset')?.textContent.includes('v2'),
    );
    await action(a, '파일 버전');
    await a.waitForFunction(() => document.querySelectorAll('.space-version-list li').length === 2);
    await a.screenshot({
      path: path.join(captures, 'space-versions-production.png'),
      fullPage: true,
    });
    await a.keyboard.press('Escape');
    await a.waitForSelector('.space-dialog', { hidden: true });
    await a.waitForFunction(() => document.activeElement?.getAttribute('title') === '자료 메뉴');
    const old = await fetch(base + `/api/v1/space/references/${originalId}/download?version=1`);
    assert.deepEqual(Buffer.from(await old.arrayBuffer()), fs.readFileSync(file('팀 운영.docx')));
    await a.click('[role="tab"][aria-controls$="-content-templates"]');
    await a.waitForSelector('.space-empty');
    await upload(a, [file('사내 소개.pptx')], '사내 발표 템플릿');
    await a.waitForSelector('.space-asset');
    await a.screenshot({
      path: path.join(captures, 'space-templates-production.png'),
      fullPage: true,
    });
    await a.click('[role="tab"][aria-controls$="-content-all"]');
    assert.ok(
      await a.$eval(
        '[role="tab"][aria-controls$="-content-all"]',
        (n) => n.getBoundingClientRect().height >= 44,
      ),
    );
    await a.waitForFunction(() => document.querySelectorAll('.space-asset').length === 2);
    assert.match(await a.$eval('.space-gallery', (n) => n.textContent), /레퍼런스/);
    assert.match(await a.$eval('.space-gallery', (n) => n.textContent), /템플릿/);
    const links = await a.$$eval('.space-asset a', (nodes) =>
      nodes.map((n) => n.getAttribute('href')),
    );
    assert.ok(links.some((url) => url.includes('/references/')));
    assert.ok(links.some((url) => url.includes('/templates/')));
    await a.focus('[role="tab"][aria-controls$="-content-all"]');
    const beforeArrow = a.url();
    await a.keyboard.press('ArrowRight');
    await a.waitForFunction(() =>
      document.activeElement?.matches('[role="tab"][aria-controls$="-content-references"]'),
    );
    assert.equal(a.url(), beforeArrow);
    await a.keyboard.press('Enter');
    await a.waitForFunction(
      () =>
        document
          .querySelector('[role="tab"][aria-controls$="-content-references"]')
          ?.getAttribute('aria-selected') === 'true',
    );
    await a.goBack({ waitUntil: 'networkidle0' });
    await a.waitForFunction(
      () =>
        document
          .querySelector('[role="tab"][aria-controls$="-content-all"]')
          ?.getAttribute('aria-selected') === 'true',
    );
    await notifications(a);
    await button(a, '.space-uploads button', '완료 항목 정리');
    await notifications(a, false);
    await a.screenshot({ path: path.join(captures, 'space-all-production.png'), fullPage: true });
    await a.click('.space-search-heading button');
    await button(a, '[role="menuitem"]', '템플릿 올리기');
    await a.waitForSelector('.space-dialog input[type="file"]');
    assert.ok(
      await a.$eval('.space-dialog .dialog-actions', (row) => {
        const [cancel, submit] = Array.from(row.children, (button) =>
          button.getBoundingClientRect(),
        );
        return submit.left - cancel.right >= 8 || submit.top - cancel.bottom >= 8;
      }),
      'Upload actions must retain a gap on direct Space entry',
    );
    assert.equal(await a.$eval('.space-dialog input[type="file"]', (n) => n.accept), '.pptx');
    await a.keyboard.press('Escape');
    await a.waitForSelector('.space-dialog', { hidden: true });
    // Failed transmission can retry with the original idempotency key.
    await a.click('[role="tab"][aria-controls$="-content-references"]');
    await a.waitForFunction(() =>
      document
        .querySelector('.space-search-heading button')
        ?.textContent.includes('레퍼런스 올리기'),
    );
    let failUpload = true;
    await a.setRequestInterception(true);
    a.on('request', (request) => {
      if (failUpload && request.method() === 'POST' && request.url().endsWith('/space/references'))
        void request.abort('failed');
      else void request.continue();
    });
    await upload(a, [file('사내 소개.pptx')], '공유 발표 원본');
    await notifications(a);
    await a.waitForSelector('button[aria-label="사내 소개.pptx 다시 시도"]');
    failUpload = false;
    await a.click('button[aria-label="사내 소개.pptx 다시 시도"]');
    await a.waitForFunction(() => document.querySelectorAll('.space-asset').length === 2);
    // Structurally invalid files never become a library item; cancel is persisted.
    await upload(a, [file('손상 문서.pdf')]);
    await notifications(a);
    await a.waitForSelector('button[aria-label="손상 문서.pdf 다시 시도"]');
    const key = await a.$eval('.space-upload-row:last-child', (n) => n.dataset.uploadId);
    await a.click('button[aria-label="손상 문서.pdf 업로드 취소"]');
    await a.waitForSelector('button[aria-label="손상 문서.pdf 업로드 취소"]', { hidden: true });
    assert.equal(
      (await (await fetch(base + '/api/v1/space/uploads/' + key)).json()).state,
      'cancelled',
    );
    await notifications(a, false);
    // Legacy management filters remain addressable; global search has its own browser journey.
    await a.goto(base + '/home/space/library?q=' + encodeURIComponent('검토 완료'), {
      waitUntil: 'networkidle0',
    });
    await a.waitForFunction(() => document.querySelectorAll('.space-asset').length === 1);
    await action(a, '보관');
    await button(a, '.space-dialog button', '보관');
    await a.waitForSelector('.space-dialog', { hidden: true });
    await a.waitForSelector('.space-empty');
    await a.goto(base + '/home/space/library?status=archived', { waitUntil: 'networkidle0' });
    await action(a, '복원');
    await button(a, '.space-dialog button', '복원');
    await a.waitForSelector('.space-dialog', { hidden: true });
    await server.stop();
    await server.start();
    await a.goto(base + '/home/space/library?tab=references', { waitUntil: 'networkidle0' });
    await a.waitForFunction(() => document.querySelectorAll('.space-asset').length === 2);
    await a.screenshot({
      path: path.join(captures, 'space-shared-production.png'),
      fullPage: true,
    });
    for (const width of [1024, 768, 390, 320]) {
      await a.setViewport({ width, height: 900 });
      assert.ok(
        await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        'Space overflow at ' + width,
      );
      if (width === 390)
        await a.screenshot({ path: path.join(captures, 'space-shared-phone.png'), fullPage: true });
    }
    await upload(a, [file('손상 문서.pdf')]);
    await a.waitForSelector('.work-dock');
    await notifications(a);
    const bounds = await a.$eval('.work-dock', (node) => {
      const r = node.getBoundingClientRect();
      return {
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
        width: innerWidth,
        height: innerHeight,
      };
    });
    assert.ok(
      bounds.left >= 0 &&
        bounds.right <= bounds.width &&
        bounds.top >= 0 &&
        bounds.bottom <= bounds.height,
    );
    await a.screenshot({
      path: path.join(captures, 'upload-work-panel-phone.png'),
      fullPage: true,
    });
    await notifications(a, false);
    await action(a, '삭제');
    await button(a, '.space-dialog button', '삭제');
    await a.waitForSelector('.space-dialog', { hidden: true });
    await a.waitForFunction(() => document.querySelectorAll('.space-asset').length === 1);
    await htmlChecks(a, b, server, fixtureRoot, captures);
    assert.deepEqual(errors, []);
    console.log(
      'PASS: tab-local upload notifications across routes, two-context and same-browser-tab isolation, panel keyboard/mobile bounds, combined/default tabs, keyboard activation, URL back, scoped actions, Space upload, byte-exact download, two shared contexts, conflict review, immutable versions, templates, network retry, invalid-file cancellation, search, archive/restore, restart, deletion, progress semantics and responsive layout.',
    );
  } finally {
    try {
      if (session) await session.close();
    } finally {
      await server.close();
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
