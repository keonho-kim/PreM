// Purpose: Verify dedicated vLLM-SR setup, native discovery, decisions and shared settings.
// Pattern: Compiled React/Rust with isolated storage and a synthetic local System One server.
// Usage: Run after pnpm build; real provider credentials and application storage are untouched.
// Related: backend/tests/vllm_sr.rs, server.cjs, frontend/features/providers/.
const { setViewport, clickRole } = require('../helpers/interactions.cjs');
const assert = require('node:assert/strict');
const { authorizedFetch: fetch } = require('./admin-client.cjs');
const http = require('node:http');
const path = require('node:path');
const { once } = require('node:events');
const { openBrowser, projectRoot } = require('../helpers/browser.cjs');
const { createServer } = require('./server.cjs');
async function click(page, name, role = 'button') {
  if (name === '모델 목록 조회' && (await page.$('.provider-form:not([hidden]) .model-picker'))) {
    await click(page, '사용할 모델 · 필수', 'combobox');
    await page.waitForFunction(
      () => !document.querySelector('.model-picker')?.textContent.includes('조회 취소'),
    );
    await page.keyboard.press('Escape');
    return;
  }

  await clickRole(page, name, role);
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
async function fill(page, name, value) {
  const input = await page.waitForSelector(`[name="${name}"]`, { visible: true });
  await input.evaluate((node) => node.select());
  await page.keyboard.press('Backspace');
  await input.type(String(value));
}
(async () => {
  let discoveries = 0,
    evaluations = 0;
  const model = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    assert.equal(req.headers.authorization, 'Bearer synthetic-vllm-sr-key');
    if (req.method === 'GET' && req.url === '/v1/systemone/models') {
      discoveries++;
      res.end(
        JSON.stringify({
          data: [
            { id: 'vllm-sr/d3-flash', question_types: ['choice', 'noul'] },
            { id: 'vllm-sr/norn-1', system: 'two' },
            { id: 'span-only', question_types: ['span'] },
          ],
        }),
      );
      return;
    }
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/v1/systemone');
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    assert.equal(body.model, 'vllm-sr/d3-flash');
    assert.equal(typeof body.state, 'string');
    evaluations++;
    res.end(
      JSON.stringify({
        model: body.model,
        answers: Object.fromEntries(
          Object.keys(body.questions).map((key) => [
            key,
            {
              type: 'choice',
              choice: '1',
              probabilities: { 0: 0.1, 1: 0.9 },
              confidence: 0.8,
            },
          ]),
        ),
        usage: { input_tokens: 20, output_tokens: 0 },
      }),
    );
  });
  model.listen(0, '127.0.0.1');
  await once(model, 'listening');
  const server = await createServer('vllm-sr-browser-');
  let session;
  try {
    await server.start();
    session = await openBrowser('vllm-sr-production');
    const a = await (await session.browser.createBrowserContext()).newPage();
    const b = await (await session.browser.createBrowserContext()).newPage();
    const errors = [];
    for (const page of [a, b]) page.on('pageerror', (error) => errors.push(error.message));
    await setViewport(a, { width: 1440, height: 1000 });
    await a.goto(server.base + '/home/admin', { waitUntil: 'networkidle0' });
    await server.unlock(a);
    await click(a, 'Decision Model 연결', 'link');
    await click(a, 'Provider', 'combobox');
    await click(a, 'vLLM-SR', 'option');
    await a.waitForFunction(
      () => document.querySelector('#provider-system')?.textContent === 'vLLM-SR',
    );
    await fill(a, 'base_url', `http://127.0.0.1:${model.address().port}/v1`);
    await fill(a, 'api_key', 'synthetic-vllm-sr-key');
    await click(a, '모델 목록 조회');
    await click(a, '사용할 모델 · 필수', 'combobox');
    assert.equal(await a.$('::-p-aria(vllm-sr/norn-1[role="option"])'), null);
    assert.equal(await a.$('::-p-aria(span-only[role="option"])'), null);
    await click(a, 'vllm-sr/d3-flash · Decision', 'option');
    assert.deepEqual(await (await fetch(server.base + '/api/v1/admin/llm/providers')).json(), []);
    await click(a, '설정 저장');
    await a.waitForSelector('.provider-summary');
    const settingsUrl = a.url();
    await click(a, '연결 주소·인증 변경');
    assert.equal(await a.$eval('input[name="api_key"]', (node) => node.value), '');
    assert.equal(await a.$eval('input[name="base_url"]', (node) => node.value), '');
    const saved = (await (await fetch(server.base + '/api/v1/admin/llm/providers')).json())[0];
    assert.equal(saved.provider_type, 'vllm_sr_decision');
    assert.equal(saved.model_identifier, 'vllm-sr/d3-flash');
    await click(a, '처리 설정', 'tab');
    await fill(a, 'max_parallel', 2);
    await fill(a, 'queue_capacity', 12);
    await click(a, '처리 설정 저장');
    await a.waitForFunction(() =>
      document
        .querySelector('.provider-capacity form [role="status"]')
        ?.textContent.includes('저장했습니다'),
    );
    await click(a, '판정 테스트', 'tab');
    await click(a, '판정 실행');
    await a.waitForSelector('[data-state="active"] .provider-result');
    assert.equal(evaluations, 1);
    await a.evaluate(() => window.scrollTo(0, 0));
    await a.screenshot({
      path: path.join(projectRoot, 'tests/.artifacts/captures/folio/admin-vllm-sr.png'),
      fullPage: true,
    });
    await a.goto(`${server.base}/home/admin?section=decision`, { waitUntil: 'networkidle0' });
    await server.unlock(a);
    await click(a, '사용할 판정 연결', 'combobox');
    await click(a, `${saved.name} · System One`, 'option');
    await click(a, '판정 연결 적용');
    await a.waitForFunction(() =>
      document
        .querySelector('.processing-settings [role="status"]')
        ?.textContent.includes('저장했습니다'),
    );
    assert.equal(evaluations, 1, 'settings changes must not trigger inference');
    await b.goto(settingsUrl, { waitUntil: 'networkidle0' });
    await server.unlock(b);
    await b.waitForSelector('.provider-summary');
    await server.stop();
    await server.start();
    await b.reload({ waitUntil: 'networkidle0' });
    await server.unlock(b);
    await b.waitForSelector('.provider-summary');
    assert.match(await b.$eval('.provider-summary', (node) => node.textContent), /vLLM-SR/);
    const retained = (await (await fetch(server.base + '/api/v1/admin/llm/providers')).json())[0];
    assert.equal(retained.model_identifier, 'vllm-sr/d3-flash');
    assert.equal(retained.config_id, saved.config_id);
    await b.bringToFront();
    await click(b, '처리 설정', 'tab');
    await b.waitForSelector('[name="max_parallel"]');
    assert.equal(await b.$eval('[name="max_parallel"]', (node) => node.value), '2');
    assert.equal(await b.$eval('[name="queue_capacity"]', (node) => node.value), '12');
    await setViewport(b, { width: 390, height: 844 });
    assert.equal(await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await click(b, '판정 테스트', 'tab');
    await click(b, '판정 실행');
    await b.waitForSelector('[data-state="active"] .provider-result');
    assert.equal(evaluations, 2);
    assert.equal(discoveries, 2);
    assert.deepEqual(errors, []);
    console.log(
      'PASS: vLLM-SR native model discovery, filtered options, encrypted saved connection, choice evaluation, capacity, processing/relation selectors, shared UI, mobile and restart.',
    );
  } finally {
    if (session) await session.close();
    await server.close();
    model.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
