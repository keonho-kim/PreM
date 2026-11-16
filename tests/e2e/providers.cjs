// Purpose: Exercise inline provider setup, native discovery and shared settings on the real server.
// Pattern: Isolated database, synthetic local model endpoints, independent browsers and restart.
// Usage: Run after pnpm build; credentials and uploads never reach real application storage.
// Related: admin-navigation.cjs, server.cjs, frontend/features/providers/.
const assert = require('node:assert/strict');
const { authorizedFetch: fetch } = require('./admin-client.cjs');
const http = require('node:http');
const path = require('node:path');
const { once } = require('node:events');
const { openBrowser, projectRoot } = require('../../mock/helpers/browser.cjs');
const { createServer } = require('./server.cjs');
const { adminNavigation } = require('./admin-navigation.cjs');
async function click(page, name, role = 'button') {
  const target = await page.waitForSelector(`::-p-aria(${name}[role="${role}"])`, {
    visible: true,
  });
  // A partially visible control may be covered by the sticky mobile navigation.
  await target.evaluate((node) => node.scrollIntoView({ block: 'center', inline: 'nearest' }));
  await target.click();
  if (role === 'tab')
    await page.waitForFunction(
      (name) =>
        [...document.querySelectorAll('[role="tab"]')].some(
          (node) => node.textContent === name && node.getAttribute('aria-selected') === 'true',
        ),
      {},
      name,
    );
}
async function choose(page, label, option) {
  await click(page, label, 'combobox');
  await click(page, option, 'option');
  await page.waitForFunction(
    (label, option) => {
      const field = [...document.querySelectorAll('label')].find(
        (node) => node.textContent === label,
      );
      return field && document.getElementById(field.htmlFor)?.textContent.includes(option);
    },
    {},
    label,
    option,
  );
}
async function field(page, name, value) {
  const input = await page.waitForSelector(`input[name="${name}"]`, { visible: true });
  await input.evaluate((e) => e.select());
  await page.keyboard.press('Backspace');
  await input.type(value);
}
(async () => {
  let inventoryCalls = 0;
  const model = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/v1/models') {
      inventoryCalls++;
      res.end(
        JSON.stringify({
          models: [
            {
              type: 'llm',
              key: 'download-model',
              loaded_instances: [{ id: 'ornith-1.5-35b-a3b' }],
            },
            {
              type: 'decision',
              key: 'download-decision',
              loaded_instances: [{ id: 'd3-flash-artemis' }],
            },
            { type: 'embedding', key: 'not-for-this-task' },
          ],
        }),
      );
      return;
    }
    if (req.url.startsWith('/v1/')) assert.equal(req.headers.authorization, 'Bearer qa-key');
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    if (req.url === '/api/v1/chat') {
      res.end(
        JSON.stringify({
          output: [{ type: 'message', content: 'PuPuTyX connection OK' }],
          stats: { input_tokens: 12, total_output_tokens: 5 },
        }),
      );
      return;
    }
    res.end(
      JSON.stringify({
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: body.response_format ? '{"status":"ok"}' : 'PuPuTyX connection OK',
            },
          },
        ],
        usage: { prompt_tokens: 12, completion_tokens: 5 },
      }),
    );
  });
  model.listen(0, '127.0.0.1');
  await once(model, 'listening');
  const endpoint = `http://127.0.0.1:${model.address().port}`;
  const server = await createServer('providers-browser-');
  let session;
  const list = async () => (await fetch(server.base + '/api/v1/admin/llm/providers')).json();
  try {
    await server.start();
    session = await openBrowser('providers-production');
    const a = await (await session.browser.createBrowserContext()).newPage();
    const b = await (await session.browser.createBrowserContext()).newPage();
    await a.bringToFront();
    const errors = [];
    for (const p of [a, b]) {
      p.on('pageerror', (e) => errors.push(e.message));
      await p.setViewport({ width: 1440, height: 1000 });
    }
    await a.goto(server.base + '/home/admin', { waitUntil: 'networkidle0' });
    await server.unlock(a);
    assert.ok(await a.$('::-p-aria(LLM[role="tab"])'));
    assert.ok(await a.$('::-p-aria(Decision[role="tab"])'));
    assert.equal(await a.$('::-p-aria(AI 모델 추가[role="button"])'), null);
    assert.equal(await a.$('input[name="model_identifier"]'), null);
    await choose(a, 'Provider', 'LM Studio · OpenAI 호환');
    await field(a, 'base_url', endpoint + '/v1');
    await field(a, 'api_key', 'qa-key');
    await click(a, '모델 목록 조회');
    await choose(a, '사용할 모델 · 필수', 'ornith-1.5-35b-a3b');
    assert.equal((await list()).length, 0);
    await click(a, '설정 저장');
    await a.waitForSelector('.provider-summary');
    const first = (await list())[0];
    assert.equal(first.model_identifier, 'ornith-1.5-35b-a3b');
    assert.equal(first.base_url, endpoint + '/v1/');
    assert.equal(await a.$eval('input[name="base_url"]', (n) => n.value), '');
    assert.equal(await a.$eval('input[name="api_key"]', (n) => n.value), '');
    await click(a, '연결 테스트', 'tab');
    await click(a, '텍스트 테스트');
    await a.waitForFunction(() =>
      document.querySelector('.provider-result')?.textContent.includes('PuPuTyX connection OK'),
    );
    await click(a, '구조화 응답 테스트');
    await a.waitForFunction(() =>
      document.querySelector('.provider-result')?.textContent.includes('JSON Schema 검증 통과'),
    );
    await b.goto(a.url(), { waitUntil: 'networkidle0' });
    await server.unlock(b);
    await b.waitForSelector('.provider-summary');
    await a.bringToFront();
    await click(a, '연결 설정', 'tab');
    await click(a, '추가 연결 설정');
    await field(a, 'name', '내 연결 설정');
    const change = await fetch(`${server.base}/api/v1/admin/llm/providers/${first.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expected_version: 1,
        name: '다른 접속자의 변경',
        provider_type: first.provider_type,
        base_url: first.base_url,
        model_identifier: first.model_identifier,
        timeout_seconds: first.timeout_seconds,
        enabled: true,
      }),
    });
    assert.equal(change.status, 200);
    await click(a, '변경 사항 저장');
    await a.waitForSelector('[role="alertdialog"]', { visible: true });
    assert.equal((await list())[0].version, 2);
    await click(a, '확인하고 저장');
    await click(a, '최신 설정 확인');
    await a.waitForFunction(() =>
      document.querySelector('.provider-form > [role="status"]')?.textContent.includes('최신 v2'),
    );
    assert.equal(await a.$eval('input[name="name"]', (n) => n.value), '내 연결 설정');
    await click(a, '변경 사항 저장');
    await click(a, '확인하고 저장');
    await a.waitForFunction(() =>
      document.querySelector('.provider-summary')?.textContent.includes('v3'),
    );
    await click(a, '연결 테스트', 'tab');
    await click(a, '구조화 응답 테스트');
    await a.waitForSelector('.provider-result');
    await adminNavigation(a, first.id, server.unlock);
    await a.screenshot({
      path: path.join(projectRoot, 'mock/captures/folio/admin-providers-production.png'),
      fullPage: true,
    });
    await a.setViewport({ width: 390, height: 844 });
    await a.screenshot({
      path: path.join(projectRoot, 'mock/captures/folio/admin-providers-phone.png'),
      fullPage: true,
    });
    assert.equal(
      await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      true,
    );
    await field(a, 'api_key', 'uncommitted-key');
    await click(a, '모델 목록 조회');
    await a
      .waitForFunction(() =>
        document.querySelector('.model-picker [role="status"]')?.textContent.includes('1개 모델'),
      )
      .catch(async (error) => {
        console.log(
          await a.$$eval('.provider-form [role="status"]', (nodes) =>
            nodes.map((node) => node.textContent),
          ),
        );
        throw error;
      });
    await click(a, '변경 사항 저장');
    await a.waitForSelector('[role="alertdialog"]');
    await a.keyboard.press('Escape');
    await a.waitForSelector('[role="alertdialog"]', { hidden: true });
    assert.equal(await a.$eval('input[name="api_key"]', (n) => n.value), 'uncommitted-key');
    await click(a, '변경 취소');
    await server.stop();
    await server.start();
    await b.reload({ waitUntil: 'networkidle0' });
    await server.unlock(b);
    assert.match(await b.$eval('.provider-summary', (n) => n.textContent), /내 연결 설정/);
    await a.bringToFront();
    await a.reload({ waitUntil: 'networkidle0' });
    await server.unlock(a);
    await choose(a, 'Provider', 'LM Studio Native');
    await field(a, 'base_url', endpoint + '/api/v1');
    await click(a, '모델 목록 조회');
    await choose(a, '사용할 모델 · 필수', 'ornith-1.5-35b-a3b');
    await click(a, '설정 저장');
    await a.waitForFunction(() =>
      document.querySelector('.provider-summary')?.textContent.includes('Native Chat'),
    );
    await click(a, '연결 테스트', 'tab');
    await click(a, '텍스트 테스트');
    await a.waitForFunction(() =>
      document.querySelector('.provider-result')?.textContent.includes('PuPuTyX connection OK'),
    );
    await click(a, 'Decision', 'tab');
    await field(a, 'base_url', endpoint + '/v1');
    await click(a, '모델 목록 조회');
    await choose(a, '사용할 모델 · 필수', 'd3-flash-artemis');
    assert.equal((await list()).length, 2);
    await click(a, '설정 저장');
    await a.waitForSelector('.provider-summary');
    assert.equal(
      (await list()).find((p) => p.provider_type === 'lm_studio_decision').model_identifier,
      'd3-flash-artemis',
    );
    await a.setViewport({ width: 1440, height: 1000 });
    await a.screenshot({
      path: path.join(projectRoot, 'mock/captures/folio/admin-decision-settings.png'),
      fullPage: true,
    });
    assert.ok(inventoryCalls >= 4);
    assert.deepEqual(errors, []);
    console.log(
      'PASS: LLM/Decision tabs, native pre-save discovery, loaded model IDs, shared edits, key retention, confirmation/cancel, independent settings, mobile and restart.',
    );
  } finally {
    if (session) await session.close();
    await server.close();
    model.closeAllConnections();
    await new Promise((r) => model.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
