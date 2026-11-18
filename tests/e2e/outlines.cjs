// Purpose: Verify paired Studio outline generation, editing, mapping and confirmation through real UI.
// Pattern: Isolated Rust server and synthetic LLM; two browser contexts, exact revisions and restart.
// Usage: Run after pnpm build; captures use tests/.artifacts/captures/folio and storage uses tests/.artifacts.
// Related: outline-fixture.cjs, backend/tests/outlines.rs, frontend/features/outlines/.
const assert = require('node:assert/strict');
const { authorizedFetch: fetch } = require('./admin-client.cjs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { createServer } = require('./server.cjs');
const { model, json } = require('./outline-fixture.cjs');
const { openBrowser, projectRoot } = require('../helpers/browser.cjs');
const { notifications } = require('./space-checks.cjs');
async function click(page, name, role = 'button') {
  const target = await page.waitForSelector(`::-p-aria(${name}[role="${role}"])`, {
    visible: true,
  });
  await target.evaluate((n) => n.scrollIntoView({ block: 'center', inline: 'nearest' }));
  await target.click();
}
async function fill(page, selector, value) {
  const field = await page.waitForSelector(selector, { visible: true });
  await field.evaluate((n) => n.select());
  await page.keyboard.press('Backspace');
  await field.type(value);
}
async function poll(check) {
  for (let i = 0; i < 200; i++) {
    if (await check()) return;
    await delay(50);
  }
  throw Error('condition timeout');
}
(async () => {
  const server = await createServer('outlines-browser-');
  const fixture = await model();
  let session;
  try {
    await server.start();
    const project = await json(server.base, '/api/v1/projects', 'POST', {
      name: '분기 발표 준비',
      due_date: '2030-01-01',
    });
    const p = project.id;
    const author = randomUUID();
    await json(server.base, `/api/v1/admin/llm/providers/${author}`, 'PUT', {
      expected_version: 0,
      name: '목차 작성 AI',
      provider_type: 'openai_compatible',
      base_url: fixture.base,
      model_identifier: 'outline-fixture',
      timeout_seconds: 30,
      enabled: true,
    });
    await json(server.base, '/api/v1/admin/document-processing/settings', 'PUT', {
      expected_version: 0,
      connection_id: author,
    });
    const read = () => json(server.base, `/api/v1/projects/${p}/outline`);
    const route = `${server.base}/home/studio/${p}`;
    session = await openBrowser('outlines-production');
    const a = await (await session.browser.createBrowserContext()).newPage();
    const b = await (await session.browser.createBrowserContext()).newPage();
    const errors = [];
    for (const page of [a, b]) page.on('pageerror', (e) => errors.push(e.message));
    await a.setViewport({ width: 1440, height: 1000 });
    await a.goto(route, { waitUntil: 'networkidle0' });
    await click(a, '문서 추가');
    await (await a.waitForSelector('.space-dialog input[type=file]')).uploadFile(
      path.join(projectRoot, 'tests/fixtures/documents/reference.md'),
    );
    await a.click('.space-dialog button[type=submit]');
    await a.waitForSelector('.space-dialog', { hidden: true });
    await a.waitForFunction(() => !document.querySelector('.studio-review button')?.disabled);
    await notifications(a, false);
    await click(a, '원본 확인하고 계속');
    await a.waitForSelector('#guide-do', { visible: true });
    await a.type('#guide-do', '실행 계획을 먼저 보여주세요.');
    assert.equal(await a.$eval('button[aria-label="목차·내용"]', (n) => n.disabled), true);
    await click(a, '저장하고 목차로');
    assert.equal(await a.$('#outline-model'), null);
    await click(a, '목차 만들기');
    await poll(async () => (await read()).version === 1);
    await a.waitForFunction(
      () => document.querySelectorAll('.outline-content-tabs [role=tab]').length === 3,
    );
    assert.equal(await a.$('.outline-node-list'), null);
    await click(a, '목차 편집');
    let state = await read();
    const child = state.draft.nodes[1].id,
      root = state.draft.nodes[0].id;
    await fill(a, `#outline-title-${child}`, '현재 상황');
    await click(a, '편집 마치기');
    assert.equal(await a.$('.outline-node-list'), null);
    await a.waitForFunction(
      () => document.activeElement.getAttribute('aria-label') === '목차 편집',
    );
    assert.equal(await a.$eval('button[aria-label="근거"]', (n) => n.disabled), true);
    await click(a, '목차·연결 저장');
    await poll(async () => (await read()).version === 2);
    await click(a, '목차 추가');
    await click(a, '새 대목차 위로');
    assert.equal(
      await a.evaluate(() => document.activeElement.getAttribute('aria-label')),
      '새 대목차 위로',
    );
    await click(a, '편집 마치기');
    await click(a, '목차·연결 저장');
    await poll(async () => (await read()).version === 3);
    await click(a, '목차 편집');
    await click(a, '새 대목차 삭제');
    await click(a, '편집 마치기');
    await click(a, '목차·연결 저장');
    await poll(async () => (await read()).version === 4);
    await click(a, 'AI로 구성');
    await click(a, '전체 내용 자동 연결');
    await poll(async () => {
      const s = await read();
      assert.notEqual(s.run?.status, 'failed', JSON.stringify(s));
      return s.version === 5;
    });
    await a.waitForFunction(() =>
      document.querySelector('.outline-save')?.textContent.includes('저장된 버전 5'),
    );
    await a
      .locator(`[role="tab"][data-state]`)
      .filter((n) => n.textContent.includes('업무 현황'))
      .click();
    await click(a, '내용 담기');
    const link = await a.waitForSelector(
      '.outline-picker-dialog .outline-source-block button[aria-pressed="false"]',
    );
    await link.click();
    await click(a, '선택 마치기');
    await a.waitForFunction(() => document.activeElement.textContent.trim() === '내용 담기');
    await click(a, '목차·연결 저장');
    await poll(async () => (await read()).version === 6);
    await a.waitForFunction(() =>
      document.querySelector('.outline-save')?.textContent.includes('저장된 버전 6'),
    );
    await click(a, '목차·내용 확정');
    await poll(async () => (await read()).confirmed === true);
    await notifications(a, true);
    await click(a, '완료 항목 정리');
    await a.waitForSelector('.work-panel-empty');
    await a.click('button[aria-label="작업 패널 닫기"]');
    await a.evaluate(() => window.scrollTo(0, 0));
    await a.screenshot({
      path: path.join(projectRoot, 'tests/.artifacts/captures/folio/studio-outline-authoring.png'),
      fullPage: true,
    });
    const beforeEvidence = fixture.calls();
    await click(a, '근거');
    await a.waitForSelector('.evidence-tabs');
    assert.equal(new URL(a.url()).searchParams.get('step'), 'evidence');
    assert.equal(
      await a.$eval('.evidence-tabs > [role=tablist] [aria-selected="true"]', (n) => n.textContent),
      '선택한 근거',
    );
    assert.equal(fixture.calls(), beforeEvidence);
    await click(a, '목차·내용');
    await click(a, '목차 버전', 'combobox');
    await click(a, '버전 1', 'option');
    await a.waitForFunction(() =>
      document.querySelector('.outline-save')?.textContent.includes('이전 버전 1'),
    );
    assert.equal(await a.$('input[id^="outline-title-"]'), null);
    assert.equal(await a.$('[aria-label="목차 편집"]'), null);
    await click(a, '목차 버전', 'combobox');
    await click(a, '현재 목차', 'option');
    await a.waitForFunction(() =>
      document.querySelector('.outline-save')?.textContent.includes('확정했습니다'),
    );
    await b.goto(route + '?step=outline', { waitUntil: 'networkidle0' });
    await b.waitForFunction(() =>
      document.querySelector('.outline-content-tabs')?.textContent.includes('현재 상황'),
    );
    await click(b, '목차 편집');
    assert.equal(await b.$eval(`#outline-title-${child}`, (n) => n.value), '현재 상황');
    await click(b, '편집 마치기');
    assert.equal((await read()).version, 6);
    await a.setViewport({ width: 390, height: 844 });
    assert.equal(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await a.evaluate(() => window.scrollTo(0, 0));
    await a.screenshot({
      path: path.join(projectRoot, 'tests/.artifacts/captures/folio/studio-outline-phone.png'),
    });
    await click(a, '목차 편집');
    assert.equal(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await a.screenshot({
      path: path.join(projectRoot, 'tests/.artifacts/captures/folio/studio-outline-edit-phone.png'),
    });
    await a.keyboard.press('Escape');
    await a.waitForFunction(
      () => document.activeElement.getAttribute('aria-label') === '목차 편집',
    );
    await click(a, '내용 담기');
    assert.equal(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await a.screenshot({
      path: path.join(
        projectRoot,
        'tests/.artifacts/captures/folio/studio-outline-picker-phone.png',
      ),
    });
    await a.keyboard.press('Escape');
    await a.waitForFunction(() => document.activeElement.textContent.trim() === '내용 담기');
    await a.$eval('.outline-mapping', (n) =>
      window.scrollTo(
        0,
        window.scrollY +
          n.getBoundingClientRect().top -
          document.querySelector('.app-header').getBoundingClientRect().height -
          16,
      ),
    );
    await a.screenshot({
      path: path.join(
        projectRoot,
        'tests/.artifacts/captures/folio/studio-outline-phone-content.png',
      ),
    });
    const calls = fixture.calls();
    await b.bringToFront();
    await click(b, '작성 방향');
    await b.waitForSelector('#guide-dont', { visible: true });
    await b.type('#guide-dont', '과장된 표현을 제외하세요.');
    await click(b, '작성 방향 저장');
    await poll(async () => (await read()).stale === true);
    assert.equal((await read()).version, 6);
    assert.equal(fixture.calls(), calls);
    await server.stop();
    await server.start();
    await a.reload({ waitUntil: 'networkidle0' });
    await a.waitForFunction(() =>
      document.querySelector('.outline-content-tabs')?.textContent.includes('현재 상황'),
    );
    await click(a, '목차 편집');
    assert.equal(await a.$eval(`#outline-title-${child}`, (n) => n.value), '현재 상황');
    await click(a, '편집 마치기');
    assert.equal((await read()).confirmed, false);
    assert.equal((await json(server.base, '/api/v1/space/all')).total, 0);
    assert.deepEqual(errors, []);
    assert.ok(root);
    console.log(
      'PASS: Studio source/guide → generated outline, stable reorder/add/delete, scoped source mapping, explicit confirm, immutable history, shared browsers, guide invalidation, mobile and restart.',
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
