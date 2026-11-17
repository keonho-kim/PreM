// Purpose: Verify adaptive source discovery, separate planner settings and visible source evidence.
// Pattern: Real product server, synthetic local models, isolated storage and independent browsers.
// Usage: Run after pnpm build; screenshots belong to mock/captures/folio.
// Related: related-fixture.cjs, backend/tests/related_exploration.rs.
const assert = require('node:assert/strict');
const { authorizedFetch: fetch } = require('./admin-client.cjs');
const path = require('node:path');
const { createServer } = require('./server.cjs');
const { openBrowser, projectRoot } = require('../../mock/helpers/browser.cjs');
const { model, json, seed, upload, ready } = require('./related-fixture.cjs');
async function click(page, name, role = 'button') {
  const button = await page.waitForSelector(`::-p-aria(${name}[role="${role}"])`, {
    visible: true,
  });
  await button.evaluate((n) => n.scrollIntoView({ block: 'center' }));
  await button.click();
}
(async () => {
  const server = await createServer('related-exploration-'),
    fixture = await model();
  let session;
  try {
    await server.start();
    const { target } = await seed(server.base, fixture.base);
    const past = await json(server.base, '/api/v1/projects', 'POST', {
      name: '비교 기준 자료',
      due_date: '2030-01-01',
    });
    for (const [name, text] of [
      ['비교 기준.html', 'BRIDGE_TOKEN 동일 기간과 단위로 측정한 비교 기준입니다.'],
      ['일정 메모.html', '일정 검토 참고 메모입니다.'],
      ['효율 분석.html', 'efficiency NEEDS_MORE 절감 수치의 비교 기준이 추가로 필요합니다.'],
    ]) {
      const item = await upload(
        server.base,
        past.id,
        name,
        `<!DOCTYPE html><html><body><p>${text}</p></body></html>`,
      );
      await ready(server.base, past.id, item);
    }
    const planner = await json(
      server.base,
      `/api/v1/admin/llm/providers/${crypto.randomUUID()}`,
      'PUT',
      {
        expected_version: 0,
        name: '추가 검색 AI',
        provider_type: 'lm_studio',
        base_url: fixture.base,
        model_identifier: 'planner',
        timeout_seconds: 30,
        enabled: true,
      },
    );
    session = await openBrowser('related-exploration');
    const a = await (await session.browser.createBrowserContext()).newPage(),
      b = await (await session.browser.createBrowserContext()).newPage();
    const errors = [];
    let evidenceCalls = 0;
    for (const p of [a, b]) p.on('pageerror', (e) => errors.push(e.message));
    a.on('request', (r) => {
      if (r.url().endsWith('/evidence')) evidenceCalls++;
    });
    await a.setViewport({ width: 1440, height: 1000 });
    await a.goto(server.base + '/home/admin?section=related', { waitUntil: 'networkidle0' });
    await server.unlock(a);
    await a.waitForSelector('#processing-model');
    const prior = await json(server.base, '/api/v1/admin/related-search/settings');
    await json(server.base, '/api/v1/admin/related-search/settings', 'PUT', {
      expected_version: prior.version,
      connection_id: prior.connection_id,
      planner_connection_id: planner.id,
    });
    await a.screenshot({
      path: path.join(projectRoot, 'mock/captures/folio/related-exploration-settings.png'),
      fullPage: true,
    });
    const route = `${server.base}/home/studio/${target.id}?step=evidence`;
    await a.goto(route, { waitUntil: 'networkidle0' });
    assert.equal(
      await a.$eval('.evidence-tabs > [role=tablist] [aria-selected="true"]', (n) => n.textContent),
      '선택한 근거',
    );
    await click(a, '추가 검색', 'tab');
    await a.waitForSelector('#related-query', { visible: true });
    await a.waitForFunction(() => document.querySelector('#related-query')?.disabled === false);
    await a.type('#related-query', 'efficiency');
    assert.equal(await a.$eval('#related-query', (n) => n.value), 'efficiency');
    await click(a, '관련 자료 찾기');
    await a.waitForFunction(
      () =>
        document.querySelector('.related-progress')?.textContent.includes('개 후보를 확인했습니다'),
      { timeout: 60000 },
    );
    const id = new URL(a.url()).searchParams.get('search');
    const get = () => json(server.base, `/api/v1/projects/${target.id}/related-searches/${id}`);
    const done = await get();
    assert.equal(done.query, 'efficiency');
    assert.equal(done.exploration.round, 2);
    assert.ok(done.exploration.added_candidates >= 2);
    assert.ok(done.exploration.unresolved > 0);
    assert.equal(fixture.state.plannerCalls, 1);
    assert.equal(evidenceCalls, 0);
    await a.evaluate(() => window.scrollTo(0, 0));
    await a.screenshot({
      path: path.join(projectRoot, 'mock/captures/folio/related-exploration-results.png'),
    });
    const results = await json(
      server.base,
      `/api/v1/projects/${target.id}/related-searches/${id}/results?kind=file`,
    );
    const bridge = results.items.find((i) => i.origins[0].filename === '비교 기준.html');
    assert.ok(bridge);
    const row = `[data-candidate-id="${bridge.id}"]`;
    const disclose = await a.waitForSelector(`${row} .related-title`, { visible: true });
    await disclose.evaluate((n) => n.scrollIntoView({ block: 'center' }));
    await disclose.click();
    await a.waitForFunction(
      (selector) => document.querySelector(selector)?.textContent.includes('BRIDGE_TOKEN'),
      {},
      '.evidence-reader',
    );
    assert.ok(evidenceCalls >= 1);
    const paneHeight = () => a.$eval('.evidence-reader', (n) => n.getBoundingClientRect().height);
    const tallPane = await paneHeight();
    await a.setViewport({ width: 1440, height: 760 });
    await a.waitForFunction(() => document.querySelector('.evidence-reader').clientHeight < 700);
    assert.ok(tallPane - (await paneHeight()) > 200, 'Reading panes follow viewport height');
    await a.setViewport({ width: 1440, height: 1000 });
    await a.$eval('.evidence-workbench', (n) =>
      window.scrollTo(
        0,
        window.scrollY +
          n.getBoundingClientRect().top -
          (Number.parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue('--studio-sticky-height'),
          ) || document.querySelector('.app-header').getBoundingClientRect().height) -
          16,
      ),
    );
    await a.screenshot({
      path: path.join(projectRoot, 'mock/captures/folio/related-exploration-evidence.png'),
    });
    await a.click(`${row} .related-select`);
    await a.waitForFunction(
      (s) => document.querySelector(s)?.getAttribute('aria-pressed') === 'true',
      {},
      `${row} .related-select`,
    );
    await b.goto(route + `&search=${id}`, { waitUntil: 'networkidle0' });
    await click(b, '선택한 근거', 'tab');
    await b.waitForSelector(`.evidence-tabs > [role=tabpanel][data-state=active] ${row}`);
    const source = await a.waitForSelector('.evidence-reader .evidence-passages li button');
    await source.evaluate((n) => n.scrollIntoView({ block: 'center' }));
    await source.click();
    await a.waitForSelector('.processing-dialog');
    await a.waitForSelector('.processing-block');
    await a.keyboard.press('Escape');
    await a.waitForSelector('.processing-dialog', { hidden: true });
    for (const width of [390, 320]) {
      await a.setViewport({ width, height: 844 });
      assert.equal(
        await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
    }
    await a.setViewport({ width: 390, height: 844 });
    await a.waitForSelector('.evidence-back', { visible: true });
    assert.equal(
      await a.$eval('.evidence-workbench .related-results', (n) => getComputedStyle(n).display),
      'none',
    );
    assert.equal(
      await a.$eval('.evidence-reader', (n) => getComputedStyle(n).overflowY),
      'visible',
    );
    assert.equal(await a.$eval('.related-search-form', (n) => getComputedStyle(n).display), 'none');
    await click(a, '목록으로');
    assert.equal(await a.$eval('.evidence-reader', (n) => getComputedStyle(n).display), 'none');
    assert.equal(await a.$eval(`${row} .related-title`, (n) => document.activeElement === n), true);
    assert.equal(await a.$eval('#related-query', (n) => n.value), 'efficiency');
    assert.equal(
      await a.$eval('.evidence-workbench .related-results', (n) => getComputedStyle(n).overflowY),
      'visible',
    );
    const listScroll = await a.evaluate(() => scrollY);
    await a.keyboard.press('Enter');
    await a.waitForSelector('.evidence-back', { visible: true });
    assert.equal(await a.$eval('.evidence-back', (n) => document.activeElement === n), true);
    await click(a, '비교 자료', 'tab');
    await click(a, '원문', 'tab');
    await a.$eval('.evidence-workbench', (n) =>
      window.scrollTo(
        0,
        window.scrollY +
          n.getBoundingClientRect().top -
          (Number.parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue('--studio-sticky-height'),
          ) || document.querySelector('.app-header').getBoundingClientRect().height) -
          16,
      ),
    );
    await a.screenshot({
      path: path.join(projectRoot, 'mock/captures/folio/related-exploration-phone.png'),
    });
    await click(a, '목록으로');
    assert.ok(Math.abs((await a.evaluate(() => scrollY)) - listScroll) < 2);
    await a.screenshot({
      path: path.join(projectRoot, 'mock/captures/folio/evidence-mobile-list.png'),
    });
    const calls = fixture.state.calls;
    await server.stop();
    await server.start();
    await b.reload({ waitUntil: 'networkidle0' });
    await click(b, '선택한 근거', 'tab');
    await b.waitForSelector(`.evidence-tabs > [role=tabpanel][data-state=active] ${row}`);
    assert.deepEqual((await get()).exploration, done.exploration);
    assert.equal(fixture.state.calls, calls);
    assert.equal((await json(server.base, '/api/v1/search?q=BRIDGE_TOKEN')).total, 0);
    assert.deepEqual(errors, []);
    console.log(
      'PASS: Admin planner/Decision selection, dynamic pull, bounded evidence disclosure, exact source preview, shared selection, mobile and restart; Space scope unchanged.',
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
