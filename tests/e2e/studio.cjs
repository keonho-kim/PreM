// Purpose: Verify real Studio originals, project isolation, page previews, confirmation and guide persistence.
// Pattern: Two browser contexts and restartable compiled server with disposable QA storage.
// Usage: Run after pnpm build; captures belong under tests/.artifacts/captures/folio.
// Related: backend/tests/studio_sources.rs, space-checks.cjs, home-checks.cjs.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { openBrowser, projectRoot } = require('../helpers/browser.cjs');
const { createServer } = require('./server.cjs');
const { configureDocuments } = require('./configure-documents.cjs');
const { setDate } = require('./home-checks.cjs');
const { notifications } = require('./space-checks.cjs');
async function upload(page, files, title) {
  await page.waitForSelector('.space-dialog input[type=file]');
  await (await page.$('.space-dialog input[type=file]')).uploadFile(...files);
  if (title)
    await page.type('.space-dialog input[placeholder="비워두면 파일 이름을 사용합니다"]', title);
  await page.click('.space-dialog button[type=submit]');
  await page.waitForSelector('.space-dialog', { hidden: true });
}
async function click(page, name, role = 'button') {
  const target = await page.waitForSelector(`::-p-aria(${name}[role="${role}"])`, {
    visible: true,
  });
  await target.evaluate((node) => node.scrollIntoView({ block: 'center', inline: 'nearest' }));
  await target.click();
}
async function capture(page, name) {
  await page.mouse.move(0, 0);
  await page.waitForFunction(() => !document.querySelector('[data-sonner-toast]'), {
    timeout: 10000,
  });
  await page.screenshot({
    path: path.join(projectRoot, 'tests/.artifacts/captures/folio', name),
    fullPage: (page.viewport()?.width ?? 1440) > 640,
  });
}
(async () => {
  const server = await createServer('studio-browser-');
  let session, fixture;
  try {
    await server.start();
    fixture = await configureDocuments(server.base);
    session = await openBrowser('studio-production');
    const a = await (await session.browser.createBrowserContext()).newPage(),
      b = await (await session.browser.createBrowserContext()).newPage();
    const errors = [];
    for (const p of [a, b]) p.on('pageerror', (e) => errors.push(e.message));
    await a.setViewport({ width: 1440, height: 1000 });
    await a.goto(server.base + '/home', { waitUntil: 'networkidle0' });
    await a.click('#project-create-button');
    await a.type('.project-dialog input[name=name]', '발표 원본 준비');
    await setDate(a);
    await a.click('.project-dialog button[type=submit]');
    await a.waitForFunction(() => location.pathname.includes('/studio/'));
    await a.waitForSelector('.studio-empty');
    const project = new URL(a.url()).pathname.split('/').at(-1);
    const route = server.base + `/home/studio/${project}`;
    await capture(a, 'studio-empty.png');
    assert.equal(await a.$('.studio-review button'), null);
    await click(a, '파일 형식·이름 설정');
    await a.type('.studio-upload input:not([type=file])', '프로젝트 보고서');
    await (await a.waitForSelector('.studio-upload input[type=file]')).uploadFile(
      path.join(projectRoot, 'tests/fixtures/documents/text.pdf'),
    );
    await a.waitForSelector('.studio-source-card');
    await a.waitForFunction(() => !document.querySelector('.studio-review button').disabled, {
      timeout: 90000,
    });
    await notifications(a, false);
    await b.goto(route, { waitUntil: 'networkidle0' });
    await b.waitForSelector('.studio-source-card');
    assert.equal(await b.$('.work-dock'), null);
    const files = await (await fetch(server.base + `/api/v1/projects/${project}/files`)).json();
    assert.equal(files.total, 1);
    const source = files.items[0];
    const space = await (await fetch(server.base + '/api/v1/space/all')).json();
    assert.equal(space.total, 0);
    await capture(a, 'studio-sources.png');
    await a.click('.studio-source-open');
    await a.waitForSelector('.processing-pages img');
    assert.equal(await a.$$eval('.processing-stages li', (nodes) => nodes.length), 3);
    assert((await a.$eval('.processing-stages', (n) => n.textContent)).includes('문서 읽기'));
    await capture(a, 'studio-document-engine.png');
    await a.waitForFunction(() =>
      Array.from(document.querySelectorAll('.processing-pages img')).some(
        (i) => i.complete && i.naturalWidth > 0,
      ),
    );
    assert.equal(await a.$eval('.processing-pages img', (i) => i.loading), 'lazy');
    assert.equal(await a.$('::-p-aria(PPT에 쓸 자료[role="tab"])'), null);
    await capture(a, 'studio-document-pages.png');
    await a.keyboard.press('Escape');
    await a.waitForSelector('.processing-dialog', { hidden: true });
    await click(a, '원본 확인하고 계속');
    await a.waitForSelector('#guide-do', { visible: true });
    await a.type('#guide-do', '핵심 내용과 실행 계획을 먼저 보여주세요.');
    await a.type('#guide-dont', '근거 없는 숫자는 넣지 마세요.');
    await click(a, '작성 방향 저장');
    await a.waitForFunction(() =>
      document
        .querySelector('.studio-direction [role=status]')
        ?.textContent.includes('저장했습니다'),
    );
    await capture(a, 'studio-direction.png');
    await b.reload({ waitUntil: 'networkidle0' });
    assert.match(await b.$eval('.studio-review', (n) => n.textContent), /원본 확인 완료/);
    await click(a, '원본 등록');
    await click(a, `${source.title} 메뉴`);
    await click(a, '파일 교체', 'menuitem');
    await upload(a, [path.join(projectRoot, 'tests/fixtures/documents/office.docx')]);
    await a.waitForFunction(
      () => document.querySelector('.studio-source-card')?.textContent.includes('버전 2'),
      { timeout: 30000 },
    );
    const review = await (
      await fetch(server.base + `/api/v1/projects/${project}/source-review`)
    ).json();
    assert.equal(review.confirmed, false);
    const original = Buffer.from(
      await (
        await fetch(
          server.base + `/api/v1/projects/${project}/files/${source.id}/download?version=1`,
        )
      ).arrayBuffer(),
    );
    assert.deepEqual(
      original,
      fs.readFileSync(path.join(projectRoot, 'tests/fixtures/documents/text.pdf')),
    );
    await notifications(a, false);
    await a.setViewport({ width: 390, height: 844 });
    await capture(a, 'studio-sources-phone.png');
    for (const width of [390, 320]) {
      await a.setViewport({ width, height: 844 });
      assert.ok(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    }
    await server.stop();
    await server.start();
    await b.reload({ waitUntil: 'networkidle0' });
    await b.waitForSelector('.studio-source-card');
    assert.match(await b.$eval('.studio-source-card', (n) => n.textContent), /버전 2/);
    const guide = await (await fetch(server.base + `/api/v1/projects/${project}/guide`)).json();
    assert.equal(guide.version, 1);
    assert.match(guide.do_text, /실행 계획/);
    assert.deepEqual(errors, []);
    console.log(
      'PASS: Home → Studio, shared project-only originals, upload panel isolation, lazy page previews, review/CAS, replacement/history, guide save, mobile and restart.',
    );
  } finally {
    if (session) await session.close();
    await server.close();
    if (fixture) await fixture.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
