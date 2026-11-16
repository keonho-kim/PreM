// Purpose: Verify the real compiled shared-project UI against a persistent backend.
// Pattern: Two isolated browser contexts and restartable server with owned test data.
// Usage: pnpm test:e2e after pnpm build; screenshots stay under mock/captures/folio.
// Related: mock/helpers/browser.cjs, backend/tests/projects.rs, dev-docs/07-quality-readiness.md.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { openBrowser, projectRoot } = require('../../mock/helpers/browser.cjs');
const { createServer } = require('./server.cjs');
const { homeChecks, setDate, openAction } = require('./home-checks.cjs');
(async () => {
  const server = await createServer('shared-projects-');
  const { base } = server;
  const captures = path.join(projectRoot, 'mock/captures/folio');
  fs.mkdirSync(captures, { recursive: true });
  let session;
  try {
    await server.start();
    session = await openBrowser('projects-production');
    const first = await session.browser.createBrowserContext(),
      second = await session.browser.createBrowserContext();
    const failed = await first.newPage();
    let blockPage = true;
    await failed.setRequestInterception(true);
    failed.on('request', (request) => {
      if (blockPage && /projects-page-.*\.js/.test(request.url())) void request.abort();
      else void request.continue();
    });
    await failed.goto(base + '/home', { waitUntil: 'networkidle0' });
    await failed.waitForFunction(
      () => document.querySelector('h1')?.textContent === '화면을 불러오지 못했습니다',
    );
    blockPage = false;
    await failed.$eval('main button', (node) => node.click());
    await failed.waitForSelector('.projects-empty');
    await failed.close();
    const a = await first.newPage(),
      b = await second.newPage(),
      errors = [];
    for (const p of [a, b]) {
      p.on('pageerror', (e) => errors.push(e.message));
      await p.setViewport({ width: 1440, height: 1000 });
      await p.goto(base + '/home', { waitUntil: 'networkidle0' });
    }
    await a.waitForSelector('.projects-empty');
    await a.screenshot({
      path: path.join(captures, 'projects-empty-production.png'),
      fullPage: true,
    });
    await a.click('#project-create-button');
    await a.waitForSelector('.project-dialog input');
    assert.equal(await a.$eval('.project-dialog input', (n) => document.activeElement === n), true);
    await a.keyboard.type('2027 사내 지식 플랫폼');
    await a.keyboard.press('Escape');
    await a.waitForSelector('.project-dialog', { hidden: true });
    await a.waitForFunction(() => document.activeElement.id === 'project-create-button');
    await a.click('#project-create-button');
    await a.type('.project-dialog input', '2027 사내 지식 플랫폼');
    await setDate(a);
    await a.click('.project-dialog button[type="submit"]');
    await a.waitForSelector('.project-dialog', { hidden: true });
    await a.waitForFunction(() => location.pathname.includes('/studio/'));
    await a.goto(base + '/home', { waitUntil: 'networkidle0' });
    await a.waitForSelector('.project-card');
    await b.reload({ waitUntil: 'networkidle0' });
    await b.waitForSelector('.project-card');
    assert.match(await b.$eval('.project-gallery', (n) => n.textContent), /2027 사내 지식 플랫폼/);
    assert.deepEqual(await b.cookies(), []);
    // Open the same version in both browsers; the second write must require review.
    await openAction(a, '이름 바꾸기');
    await openAction(b, '이름 바꾸기');
    const setName = async (p, text) => {
      await p.$eval('.project-dialog input', (n) => {
        n.focus();
        n.select();
      });
      await p.keyboard.type(text);
    };
    await setName(a, '운영 지식 프로젝트');
    await a.click('.project-dialog button[type="submit"]');
    await a.waitForSelector('.project-dialog', { hidden: true });
    await setName(b, '검토 완료 프로젝트');
    await b.click('.project-dialog button[type="submit"]');
    await b.waitForFunction(() =>
      document
        .querySelector('.project-dialog [role="status"]')
        ?.textContent.includes('프로젝트가 변경'),
    );
    assert.equal(await b.$eval('.project-dialog input', (n) => n.value), '검토 완료 프로젝트');
    await b.screenshot({
      path: path.join(captures, 'project-conflict-production.png'),
      fullPage: true,
    });
    await b.$$eval('.project-dialog button', (nodes) =>
      nodes.find((n) => n.textContent.includes('최신 이름 확인')).click(),
    );
    await b.waitForFunction(() =>
      document
        .querySelector('.project-dialog [role="status"]')
        ?.textContent.includes('운영 지식 프로젝트'),
    );
    await b.click('.project-dialog button[type="submit"]');
    await b.waitForSelector('.project-dialog', { hidden: true });
    await server.stop();
    await server.start();
    await a.reload({ waitUntil: 'networkidle0' });
    await a.waitForSelector('.project-card');
    assert.match(await a.$eval('.project-gallery', (n) => n.textContent), /검토 완료 프로젝트/);
    const records = await (await fetch(base + '/api/v1/projects')).json();
    assert.equal(records.total, 1);
    assert.equal(records.items[0].version, 3);
    // Literal text must not become markup.
    await a.click('#project-create-button');
    await a.type('.project-dialog input[name="name"]', '<img src=x onerror=alert(1)>');
    await setDate(a);
    await a.click('.project-dialog button[type="submit"]');
    await a.waitForSelector('.project-dialog', { hidden: true });
    await a.waitForFunction(() => location.pathname.includes('/studio/'));
    await a.goto(base + '/home', { waitUntil: 'networkidle0' });
    await a.waitForFunction(() => document.querySelectorAll('.project-card').length === 2);
    assert.equal(await a.$('.project-gallery img'), null);
    await a.type('.project-filters input[type="search"]', '검토');
    await a.click('.project-filters button[type="submit"]');
    await a.waitForFunction(() => document.querySelectorAll('.project-card').length === 1);
    await a.screenshot({
      path: path.join(captures, 'projects-shared-production.png'),
      fullPage: true,
    });
    for (const width of [1024, 768, 390, 320]) {
      await a.setViewport({ width, height: 900 });
      assert.ok(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      if (width === 390)
        await a.screenshot({
          path: path.join(captures, 'projects-shared-phone.png'),
          fullPage: true,
        });
    }
    await homeChecks(a, base, captures);
    assert.deepEqual(errors, []);
    console.log(
      'PASS: shared browser contexts, shadcn dialog keyboard/focus, create, conflict review, restart persistence, literal text, search and responsive layout.',
    );
  } finally {
    try {
      if (session) await session.close();
    } finally {
      await server.close();
    }
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
