// Purpose: Verify news-style unified Space search and normal-page document navigation.
// Pattern: Real server, synthetic shared references/templates, two browsers and a synthetic classification model.
// Usage: Run after pnpm build; isolated data under tests/.artifacts, captures under tests/.artifacts/captures.
// Related: server.cjs, backend/tests/library_search.rs, features/search/.
const assert = require('node:assert/strict');
const { authorizedFetch: fetch } = require('./admin-client.cjs');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { createServer } = require('./server.cjs');
const { model, json } = require('./outline-fixture.cjs');
const { openBrowser, projectRoot } = require('../helpers/browser.cjs');
async function upload(base, kind, name, title, bytes) {
  const form = new FormData();
  form.set('file', new Blob([bytes]), name);
  form.set('title', title);
  form.set('tags', '[]');
  const r = await fetch(`${base}/api/v1/space/${kind}`, {
    method: 'POST',
    headers: { 'Idempotency-Key': randomUUID() },
    body: form,
  });
  const item = await r.json();
  assert.ok(r.ok, JSON.stringify(item));
  return item;
}
async function ready(base, item) {
  for (let attempt = 0; attempt < 600; attempt++) {
    const d = await (await fetch(`${base}/api/v1/space/${item.kind}/${item.id}/processing`)).json();
    if (d.job?.status === 'succeeded') return;
    assert.notEqual(d.job?.status, 'failed', JSON.stringify(d));
    await delay(100);
  }
  throw Error('fixture extraction timed out');
}
async function click(page, name, role = 'button') {
  const node = await page.waitForSelector(`::-p-aria(${name}[role="${role}"])`, { visible: true });
  await node.evaluate((n) => n.scrollIntoView({ block: 'center', inline: 'nearest' }));
  await node.click();
}
(async () => {
  const server = await createServer('library-search-');
  const fixture = await model();
  let session;
  try {
    await server.start();
    const provider = randomUUID();
    await json(server.base, `/api/v1/admin/llm/providers/${provider}`, 'PUT', {
      expected_version: 0,
      name: '검색 준비 판정',
      provider_type: 'openai_compatible',
      base_url: fixture.base,
      model_identifier: 'outline-fixture',
      timeout_seconds: 30,
      enabled: true,
    });
    await json(server.base, '/api/v1/admin/document-processing/settings', 'PUT', {
      expected_version: 0,
      connection_id: provider,
    });
    const fixtures = path.join(projectRoot, 'tests/fixtures/documents');
    const text = Buffer.from(
      '# 실행 보고\n\n운영 절차를 개선해 검토 시간을 줄였습니다.\n\n<img src="https://search-fixture.invalid/tracker" onerror="window.searchExecuted=true">',
    );
    const refs = [
      await upload(server.base, 'references', '실행 보고.md', '실행 보고', text),
      await upload(
        server.base,
        'references',
        '운영 사례.pdf',
        '운영 사례',
        fs.readFileSync(path.join(fixtures, 'text.pdf')),
      ),
      await upload(
        server.base,
        'templates',
        '운영 템플릿.pptx',
        '운영 템플릿',
        fs.readFileSync(path.join(fixtures, 'native-template.pptx')),
      ),
    ];
    for (const item of refs) await ready(server.base, item);
    const expectedProviders = await json(server.base, '/api/v1/admin/llm/providers');
    session = await openBrowser('library-search');
    const a = await (await session.browser.createBrowserContext()).newPage();
    const b = await (await session.browser.createBrowserContext()).newPage();
    const errors = [],
      external = [];
    for (const p of [a, b]) {
      p.on('pageerror', (e) => errors.push(e.message));
      p.on('request', (r) => {
        if (r.url().includes('search-fixture.invalid')) external.push(r.url());
      });
    }
    await a.setViewport({ width: 1440, height: 1000 });
    await a.goto(server.base + '/home/space', { waitUntil: 'networkidle0' });
    assert.equal(await a.$('#space-query'), null);
    await a.waitForSelector('#library-search');
    assert.equal(await a.$('#global-search'), null);
    await a.screenshot({
      path: path.join(projectRoot, 'tests/.artifacts/captures/folio/space-search-home.png'),
    });
    await click(a, '자료 관리', 'link');
    await a.waitForSelector('.space-gallery');
    await click(a, 'Space 검색으로', 'link');
    await a.waitForSelector('#library-search', { visible: true });
    await a.type('#library-search', '운영');
    await a.keyboard.press('Enter');
    await a.waitForSelector('.search-result');
    assert.equal(await a.$$eval('.search-result', (r) => r.length), 3);
    assert.equal(await a.$('[role="dialog"]'), null);
    assert.equal(await a.$$eval('input[type="search"]', (r) => r.length), 1);
    await a.waitForFunction(() => CSS.highlights?.get('document-search-matches')?.size > 0);
    assert.equal(
      await a.evaluate(
        () => document.querySelector('.app-navigation [aria-current="page"]')?.textContent,
      ),
      'Space',
    );
    await a.screenshot({
      path: path.join(projectRoot, 'tests/.artifacts/captures/folio/space-search-desktop.png'),
      fullPage: true,
    });
    await click(a, '검색 조건');
    await click(a, '찾을 위치', 'combobox');
    await click(a, '본문 내용', 'option');
    await click(a, '적용');
    await a.waitForFunction(() => document.querySelectorAll('.search-result').length === 1);
    await a.goBack({ waitUntil: 'networkidle0' });
    await a.waitForFunction(() => document.querySelectorAll('.search-result').length === 3);
    const resultUrl = a.url();
    await b.goto(server.base + '/home/search?q=' + encodeURIComponent('운영'), {
      waitUntil: 'networkidle0',
    });
    assert.equal(new URL(b.url()).pathname, '/home/space');
    await b.goto(server.base + '/home', { waitUntil: 'networkidle0' });
    await b.type('#global-search', '운영');
    await b.keyboard.press('Enter');
    await b.waitForSelector('.search-result');
    assert.equal(new URL(b.url()).pathname, '/home/space');
    await click(a, '실행 보고', 'link');
    await a.waitForSelector('.document-workspace .processing-block');
    assert.ok(a.url().includes('/space/documents/references/'));
    await b.goto(a.url().replace('/space/documents/', '/documents/'), {
      waitUntil: 'networkidle0',
    });
    assert.ok(b.url().includes('/space/documents/references/'));
    assert.equal(
      new URL(b.url()).searchParams.get('job'),
      new URL(a.url()).searchParams.get('job'),
    );
    assert.equal(await a.$('[role="dialog"]'), null);
    assert.equal(await a.$('.processing-search'), null);
    assert.equal(await a.evaluate(() => document.activeElement.tagName), 'H1');
    assert.equal(await a.evaluate(() => window.searchExecuted), undefined);
    await a.screenshot({
      path: path.join(projectRoot, 'tests/.artifacts/captures/folio/space-search-document.png'),
      fullPage: true,
    });
    await click(a, '검색 결과로', 'link');
    await a.waitForSelector('.search-result');
    assert.equal(await a.$eval('#library-search', (n) => n.value), '운영');
    await b.goto(resultUrl, { waitUntil: 'networkidle0' });
    await b.waitForSelector('.search-result');
    assert.equal(await b.$$eval('.search-result', (r) => r.length), 3);
    await click(a, '템플릿', 'tab');
    await a.waitForFunction(() => document.querySelectorAll('.search-result').length === 1);
    assert.match(await a.$eval('.search-result', (n) => n.textContent), /운영 템플릿/);
    await a.goBack({ waitUntil: 'networkidle0' });
    await a.waitForFunction(() => document.querySelectorAll('.search-result').length === 3);
    await a.setViewport({ width: 390, height: 844 });
    assert.equal(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await a.screenshot({
      path: path.join(projectRoot, 'tests/.artifacts/captures/folio/space-search-phone.png'),
    });
    for (let i = 0; i < 10; i++)
      await upload(server.base, 'references', `추가-${i}.md`, `운영 추가 ${i}`, text);
    await a.reload({ waitUntil: 'networkidle0' });
    await a.waitForFunction(() => document.querySelectorAll('.search-result').length === 12);
    await click(a, '다음');
    await a.waitForFunction(() => document.querySelectorAll('.search-result').length === 1);
    assert.ok(a.url().includes('offset=12'));
    await click(a, '이전');
    await a.waitForFunction(() => document.querySelectorAll('.search-result').length === 12);
    await server.stop();
    await server.start();
    await b.reload({ waitUntil: 'networkidle0' });
    await b.waitForSelector('.search-result');
    assert.deepEqual(await json(server.base, '/api/v1/admin/llm/providers'), expectedProviders);
    assert.equal(fixture.calls(), 0);
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    console.log(
      'PASS: Space-only unified search, live metadata/content, news rows, highlights, pinned non-modal document page, back/filters/pagination, shared browsers, mobile and restart.',
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
