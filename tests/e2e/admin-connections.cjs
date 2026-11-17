// Purpose: Verify consolidated Admin navigation and both decision model families.
// Pattern: Isolated application, synthetic inventory and two browser contexts.
// Usage: Run after pnpm build with PREM_BROWSER_TOOLS configured.
// Related: server.cjs, provider-directory.tsx, shared_decision_settings.rs.
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { openBrowser, projectRoot } = require('../helpers/browser.cjs');
const { createServer } = require('./server.cjs');
const { authorizedFetch: fetch } = require('./admin-client.cjs');
const path = require('node:path');
(async () => {
  const model = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    assert.equal(req.url, '/api/v1/models');
    res.end(
      JSON.stringify({
        models: [
          { type: 'llm', key: 'writing-model' },
          { type: 'decision', key: 'decision-model' },
          { type: 'embedding', key: 'excluded' },
        ],
      }),
    );
  });
  model.listen(0, '127.0.0.1');
  await once(model, 'listening');
  const server = await createServer('admin-connections-');
  let browser;
  const click = async (page, name, role = 'button') => {
    const el = await page.waitForSelector(`::-p-aria(${name}[role="${role}"])`, { visible: true });
    await el.evaluate((n) => n.scrollIntoView({ block: 'center' }));
    await el.click();
  };
  const choose = async (page, name, value) => {
    await click(page, name, 'combobox');
    await click(page, value, 'option');
    await page.waitForNetworkIdle({ idleTime: 250 });
  };
  try {
    await server.start();
    browser = await openBrowser('admin-connections');
    const page = await (await browser.browser.createBrowserContext()).newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto(server.base + '/home/admin', { waitUntil: 'networkidle0' });
    await server.unlock(page);
    assert.deepEqual(
      await page.$$eval('.admin-sidebar nav a', (ns) => ns.map((n) => n.textContent.trim())),
      ['일반', 'LLM 연결', 'Decision Model 연결'],
    );
    assert.equal(await page.$('.admin-access-bar'), null);
    assert.equal(await page.$('::-p-aria(판정 테스트[role="tab"])'), null);
    await choose(page, 'Provider', 'LM Studio · OpenAI 호환');
    await page.$eval('input[name=base_url]', (n) => {
      n.focus();
      n.select();
    });
    await page.keyboard.type(`http://127.0.0.1:${model.address().port}/v1`);
    await click(page, '사용할 모델 · 필수', 'combobox');
    await page.waitForSelector('::-p-aria(writing-model · LLM[role="option"])');
    assert.equal(await page.$('::-p-aria(decision-model · Decision[role="option"])'), null);
    await click(page, 'writing-model · LLM', 'option');
    await click(page, '설정 저장');
    await page.waitForSelector('.provider-summary');
    assert.equal(await page.$('input[name=base_url]'), null);
    assert.equal(await page.$('[data-sonner-toast]'), null);
    await click(page, 'Decision Model 연결', 'link');
    await page.waitForSelector('::-p-aria(판정 테스트[role="tab"])');
    await page.waitForSelector('#processing-model');
    await click(page, '사용할 판정 연결', 'combobox');

    // Choose the saved LLM, not the empty default.
    await page.$$eval('[role=option]', (ns) =>
      ns.find((n) => n.textContent.includes('LLM 판정')).click(),
    );
    await click(page, '판정 연결 적용');
    await page.waitForFunction(() =>
      document.querySelector('.processing-settings')?.textContent.includes('설정을 저장했습니다.'),
    );
    const settings = await (
      await fetch(server.base + '/api/v1/admin/document-processing/settings')
    ).json();
    const related = await (
      await fetch(server.base + '/api/v1/admin/related-search/settings')
    ).json();
    assert.equal(settings.connection_id, related.connection_id);
    await choose(page, 'Provider', 'LM Studio');
    await page.$eval('input[name=base_url]', (n) => {
      n.focus();
      n.select();
    });
    await page.keyboard.type(`http://127.0.0.1:${model.address().port}/v1`);
    await click(page, '사용할 모델 · 필수', 'combobox');
    await page.waitForSelector('::-p-aria(decision-model · Decision[role="option"])');
    assert.equal(await page.$('::-p-aria(writing-model · LLM[role="option"])'), null);
    await click(page, 'decision-model · Decision', 'option');
    await click(page, '설정 저장');
    await page.waitForSelector('.provider-summary');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: path.join(projectRoot, 'tests/.artifacts/captures/folio/admin-connections.png'),
      fullPage: true,
    });
    await page.setViewport({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: path.join(projectRoot, 'tests/.artifacts/captures/folio/admin-connections-phone.png'),
      fullPage: true,
    });
    await server.stop();
    await server.start();
    const second = await (await browser.browser.createBrowserContext()).newPage();
    await second.goto(server.base + '/home/admin?section=decision', { waitUntil: 'networkidle0' });
    await server.unlock(second);
    const restored = await (
      await fetch(server.base + '/api/v1/admin/related-search/settings')
    ).json();
    assert.equal(restored.connection_id, settings.connection_id);
    assert.deepEqual(errors, []);
    console.log(
      'PASS: three Admin links, token gate, automatic inventory, typed LLM/Decision choices, shared decision default, restart, independent browser, mobile layout.',
    );
  } finally {
    if (browser) await browser.close();
    await server.close();
    model.closeAllConnections();
    await new Promise((resolve) => model.close(resolve));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
