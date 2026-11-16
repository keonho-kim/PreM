// Purpose: Verify Markdown upload and safe extracted content in Space and project Studio.
// Pattern: Compiled product, two browser contexts and isolated local fixtures; no model or remote assets.
// Usage: Run after pnpm build; UI captures go under mock/captures/folio.
// Related: backend/tests/markdown_documents.rs, space-checks.cjs, server.cjs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { openBrowser, projectRoot } = require('../../mock/helpers/browser.cjs');
const { createServer } = require('./server.cjs');
const { upload, notifications } = require('./space-checks.cjs');
async function click(page, name, role = 'button') {
  const node = await page.waitForSelector(`::-p-aria(${name}[role="${role}"])`, { visible: true });
  await node.evaluate((n) => n.scrollIntoView({ block: 'center', inline: 'nearest' }));
  await node.click();
}
(async () => {
  const server = await createServer('markdown-browser-');
  let session;
  const source = path.join(projectRoot, 'tests/fixtures/documents/reference.md');
  const bytes = fs.readFileSync(source);
  try {
    await server.start();
    session = await openBrowser('markdown-production');
    const a = await (await session.browser.createBrowserContext()).newPage();
    const b = await (await session.browser.createBrowserContext()).newPage();
    const external = [],
      errors = [];
    for (const page of [a, b]) {
      page.on('request', (request) => {
        if (request.url().includes('markdown-fixture.invalid')) external.push(request.url());
      });
      page.on('pageerror', (error) => errors.push(error.message));
    }
    await a.setViewport({ width: 1440, height: 1000 });
    await a.goto(server.base + '/home/space?tab=references', { waitUntil: 'networkidle0' });
    await upload(a, [source], 'Markdown 운영 보고');
    await a.waitForSelector('.space-asset');
    await notifications(a, false);
    await a.click('.space-title-button');
    await a.waitForSelector('.processing-block');
    await a.waitForFunction(() =>
      document.querySelector('.processing-blocks')?.textContent.includes('마지막 확인 문장'),
    );
    assert.match(await a.$eval('.processing-blocks', (node) => node.textContent), /코드/);
    assert.match(
      await a.$eval('.processing-blocks', (node) => node.textContent),
      /window.puputyxMarkdownExecuted/,
    );
    assert.equal(await a.evaluate(() => window.puputyxMarkdownExecuted), undefined);
    assert.equal(
      await a.$('.processing-blocks img, .processing-blocks iframe, .processing-blocks script'),
      null,
    );
    await a.type('#block-search', '120');
    await a.keyboard.press('Enter');
    await a.waitForFunction(
      () =>
        [...document.querySelectorAll('.processing-block pre')].every((node) =>
          node.textContent.includes('120'),
        ) && document.querySelectorAll('.processing-block').length === 1,
    );
    await a.screenshot({
      path: path.join(projectRoot, 'mock/captures/folio/space-markdown.png'),
      fullPage: true,
    });
    await a.keyboard.press('Escape');
    await a.waitForSelector('.processing-dialog', { hidden: true });
    await b.goto(server.base + '/home/space?tab=references', { waitUntil: 'networkidle0' });
    await b.waitForSelector('.space-title-button');
    assert.equal(await b.$('.work-dock'), null);
    await b.click('.space-title-button');
    await b.waitForSelector('.processing-block');
    assert.match(await b.$eval('.processing-blocks', (n) => n.textContent), /운영 보고서/);
    const listing = await (await fetch(server.base + '/api/v1/space/references')).json();
    const id = listing.items[0].id;
    const downloaded = await fetch(server.base + `/api/v1/space/references/${id}/download`);
    assert.equal(downloaded.headers.get('content-type'), 'text/markdown');
    assert.match(downloaded.headers.get('content-security-policy'), /sandbox/);
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), bytes);
    const project = await (
      await fetch(server.base + '/api/v1/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
        body: JSON.stringify({ name: 'Markdown 발표 준비', due_date: '2030-01-01' }),
      })
    ).json();
    await a.goto(`${server.base}/home/studio/${project.id}`, { waitUntil: 'networkidle0' });
    await click(a, '문서 추가');
    const input = await a.waitForSelector('.space-dialog input[type=file]');
    assert.match(await input.evaluate((node) => node.accept), /\.md,\.markdown/);
    await input.uploadFile(source);
    await a.click('.space-dialog button[type=submit]');
    await a.waitForSelector('.space-dialog', { hidden: true });
    await a.waitForSelector('.studio-source-card');
    await notifications(a, false);
    await a.click('.studio-source-preview');
    await a.waitForSelector('.processing-block');
    assert.match(await a.$eval('.processing-blocks', (node) => node.textContent), /실행 계획/);
    assert.equal((await (await fetch(server.base + '/api/v1/space/references')).json()).total, 1);
    await a.setViewport({ width: 390, height: 844 });
    assert.equal(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await a.screenshot({
      path: path.join(projectRoot, 'mock/captures/folio/studio-markdown-phone.png'),
    });
    await a.keyboard.press('Escape');
    await a.waitForSelector('.processing-dialog', { hidden: true });
    await server.stop();
    await server.start();
    await a.reload({ waitUntil: 'networkidle0' });
    await a.waitForSelector('.studio-source-preview');
    await a.click('.studio-source-preview');
    await a.waitForSelector('.processing-block');
    assert.equal(await a.evaluate(() => window.puputyxMarkdownExecuted), undefined);
    assert.deepEqual(external, []);
    assert.deepEqual(errors, []);
    console.log(
      'PASS: Markdown Space/Studio upload, shared safe blocks, text search, original attachment, project isolation, no external resources, mobile and restart.',
    );
  } finally {
    if (session) await session.close();
    await server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
