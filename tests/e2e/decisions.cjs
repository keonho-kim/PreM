// Purpose: Verify System One setup and decision testing through compiled React and Rust.
// Pattern: Local deterministic API, isolated storage, independent browser contexts and restart.
// Usage: Run after pnpm build; captures use tests/.artifacts/captures/folio and all QA data is disposable.
// Related: server.cjs, frontend/features/providers/, backend/tests/decisions.rs.
const { setViewport, clickRole } = require('../helpers/interactions.cjs');
const assert = require('node:assert/strict');
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
async function field(page, name, value) {
  const el = await page.waitForSelector(`[name="${name}"]`, { visible: true });
  await el.focus();
  await el.evaluate((e) => e.select());
  await page.keyboard.press('Backspace');
  await el.type(value);
  assert.equal(await el.evaluate((e) => e.value), value);
}
(async () => {
  let calls = 0;
  let fail = false;
  const model = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/v1/models') {
      res.end(
        JSON.stringify({
          models: [
            {
              type: 'decision',
              key: 'decision-fixture',
              loaded_instances: [{ id: 'decision-fixture', config: { physical_batch_size: 2048 } }],
            },
          ],
        }),
      );
      return;
    }
    assert.equal(req.url, '/v1/systemone');
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    if (require('./draft-probe.cjs').replyToProbe(res, body)) return;
    assert.equal(body.model, 'decision-fixture');
    assert.equal(body.questions.is_table_of_contents.type, 'choice');
    calls++;
    res.end(
      JSON.stringify({
        model: 'decision-fixture',
        answers: fail
          ? {}
          : {
              is_table_of_contents: {
                type: 'choice',
                choice: '1',
                confidence: 0.8,
                probabilities: { 0: 0.1, 1: 0.9 },
              },
            },
        usage: { input_tokens: 20, output_tokens: 1 },
      }),
    );
  });
  model.listen(0, '127.0.0.1');
  await once(model, 'listening');
  const server = await createServer('decisions-browser-');
  let session;
  try {
    await server.start();
    session = await openBrowser('decisions-production');
    const a = await (await session.browser.createBrowserContext()).newPage();
    const b = await (await session.browser.createBrowserContext()).newPage();
    await a.bringToFront();
    await setViewport(a, { width: 1440, height: 1000 });
    const errors = [];
    a.on('pageerror', (e) => errors.push(e.message));
    await a.goto(server.base + '/home/admin', { waitUntil: 'networkidle0' });
    await server.unlock(a);
    await click(a, 'Decision Model 연결', 'link');
    await click(a, 'Provider', 'combobox');
    for (const name of ['OpenAI', 'Gemini', 'LM Studio', 'TypeSafe Jev']) {
      assert.ok(await a.$(`::-p-aria(${name}[role="option"])`));
    }
    await click(a, 'LM Studio', 'option');
    await a.waitForFunction(
      () => document.querySelector('#provider-system')?.textContent === 'LM Studio',
    );
    await click(a, '추가 연결 설정');
    await field(a, 'name', 'QA · 로컬 판정 서버');
    await field(a, 'base_url', `http://127.0.0.1:${model.address().port}/v1`);
    await click(a, '모델 목록 조회');
    await click(a, '사용할 모델 · 필수', 'combobox');
    await click(a, 'decision-fixture · Decision', 'option');
    await require('./draft-probe.cjs').verifyDraft(a);
    await click(a, '설정 저장');
    await a.waitForSelector('.provider-summary');
    assert.match(await a.$eval('.provider-summary', (e) => e.textContent), /QA · 로컬 판정 서버/);
    const url = a.url();
    await click(a, '판정 테스트', 'tab');
    await click(a, '판정 실행');
    await a.waitForSelector('[data-state="active"] .provider-result');
    assert.equal(calls, 1);
    assert.match(
      await a.$eval('[data-state="active"] .provider-result', (e) => e.textContent),
      /Provider 보고값/,
    );
    await click(a, '요청 이력', 'tab');
    await a.waitForSelector('[data-state="active"] tbody tr');
    assert.match(await a.$eval('[data-state="active"] tbody', (e) => e.textContent), /판정.*완료/s);
    await click(a, '판정 테스트', 'tab');
    await field(a, 'decision_questions', 'invalid');
    assert.equal(await a.$('[data-state="active"] .provider-result'), null);
    await click(a, '판정 실행');
    await a.waitForFunction(
      () =>
        document.querySelector('[name="decision_questions"]')?.getAttribute('aria-invalid') ===
        'true',
    );
    assert.equal(await a.evaluate(() => document.activeElement.name), 'decision_questions');
    assert.equal(calls, 1);
    await a.reload({ waitUntil: 'networkidle0' });
    await server.unlock(a);
    fail = true;
    await click(a, '판정 실행');
    await a.waitForFunction(() =>
      document
        .querySelector('.provider-tabs > [data-state="active"] [role="status"]')
        ?.textContent.includes('응답 형식'),
    );
    fail = false;
    await click(a, '판정 실행');
    await a.waitForSelector('[data-state="active"] .provider-result');
    assert.equal(calls, 3);
    await a.evaluate(async () => {
      window.scrollTo(0, 0);
      await document.fonts.ready;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    await a.screenshot({
      path: path.join(
        projectRoot,
        'tests/.artifacts/captures/folio/admin-decisions-production.png',
      ),
      fullPage: true,
    });
    await setViewport(a, { width: 390, height: 844 });
    assert.equal(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await a.evaluate(async () => {
      window.scrollTo(0, 0);
      await document.fonts.ready;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    await a.screenshot({
      path: path.join(projectRoot, 'tests/.artifacts/captures/folio/admin-decisions-phone.png'),
      fullPage: true,
    });
    await b.goto(url, { waitUntil: 'networkidle0' });
    await server.unlock(b);
    await b.waitForSelector('.provider-summary');
    assert.match(await b.$eval('.provider-summary', (e) => e.textContent), /QA · 로컬 판정 서버/);
    await server.stop();
    await server.start();
    await b.reload({ waitUntil: 'networkidle0' });
    await server.unlock(b);
    await b.waitForSelector('.provider-summary');
    await b.bringToFront();
    await click(b, '요청 이력', 'tab');
    await b.waitForSelector('[data-state="active"] tbody tr');
    assert.equal(await b.$$eval('[data-state="active"] tbody tr', (rows) => rows.length), 3);
    assert.deepEqual(errors, []);
    console.log(
      'Decision browser: System/LLM setup, OpenAI/Gemini options, native batch, invalid input, retry, shared settings, restart and mobile passed',
    );
  } finally {
    if (session) await session.close();
    await server.close();
    model.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
