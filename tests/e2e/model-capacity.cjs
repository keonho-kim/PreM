// Purpose: Verify shared editable model capacity and actual queued requests in the compiled Admin UI.
// Pattern: Two browser contexts, isolated SQLite and a local held LLM/System One HTTP fixture.
// Usage: Run after pnpm build; model settings and application data are never used for QA.
// Related: server.cjs, backend/tests/model_capacity.rs, frontend/features/providers/provider-capacity.tsx.
const assert = require('node:assert/strict');
const { authorizedFetch: fetch } = require('./admin-client.cjs');
const http = require('node:http');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { createServer } = require('./server.cjs');
const { openBrowser, projectRoot } = require('../../mock/helpers/browser.cjs');
async function waitFor(check) {
  const until = Date.now() + 10000;
  while (!(await check())) {
    assert.ok(Date.now() < until, 'condition timeout');
    await delay(20);
  }
}
async function click(page, name, role = 'button') {
  await (await page.waitForSelector(`::-p-aria(${name}[role="${role}"])`)).click();
}
async function fill(page, name, value) {
  const input = await page.waitForSelector(`.provider-capacity input[name="${name}"]`);
  await input.evaluate((n) => n.select());
  await page.keyboard.press('Backspace');
  await input.type(String(value));
}
async function save(page) {
  await click(page, '처리 설정 저장');
  await page.waitForFunction(() =>
    document
      .querySelector('.provider-capacity form [role="status"]')
      ?.textContent.includes('처리 설정을 저장했습니다.'),
  );
}
(async () => {
  let hold = true,
    calls = 0;
  const waiting = [];
  const model = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    calls++;
    const send = () => {
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify(
          req.url === '/v1/systemone'
            ? {
                model: body.model,
                answers: {
                  toc: {
                    type: 'choice',
                    choice: '1',
                    probabilities: { 0: 0.1, 1: 0.9 },
                    confidence: 0.8,
                  },
                },
              }
            : {
                choices: [{ finish_reason: 'stop', message: { content: 'PreM connection OK' } }],
              },
        ),
      );
    };
    if (hold) waiting.push(send);
    else send();
  });
  model.listen(0, '127.0.0.1');
  await once(model, 'listening');
  const server = await createServer('capacity-browser-');
  let session;
  const ids = [randomUUID(), randomUUID()];
  const json = (method, body) => ({
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const request = (id) =>
    fetch(
      `${server.base}/api/v1/admin/llm/providers/${id}/test`,
      json('POST', { expected_version: 1, kind: 'text' }),
    );
  const get = async (id) =>
    (await fetch(`${server.base}/api/v1/admin/llm/providers/${id}/capacity`)).json();
  try {
    await server.start();
    for (const [i, id] of ids.entries()) {
      const saved = await fetch(
        `${server.base}/api/v1/admin/llm/providers/${id}`,
        json('PUT', {
          expected_version: 0,
          name: i ? '자료 확인 AI' : '문서 작성 AI',
          provider_type: i ? 'lm_studio_decision' : 'openai_compatible',
          base_url: `http://127.0.0.1:${model.address().port}/v1`,
          model_identifier: 'fixture',
          timeout_seconds: 30,
          enabled: true,
        }),
      );
      assert.equal(saved.status, 200);
    }
    session = await openBrowser('model-capacity');
    const a = await (await session.browser.createBrowserContext()).newPage();
    const b = await (await session.browser.createBrowserContext()).newPage();
    const errors = [];
    for (const p of [a, b]) p.on('pageerror', (e) => errors.push(e.message));
    const url = `${server.base}/home/admin?provider=${ids[0]}&tab=capacity`;
    await a.setViewport({ width: 1440, height: 1000 });
    await a.goto(url, { waitUntil: 'networkidle0' });
    await server.unlock(a);
    await a.waitForSelector('.provider-capacity input');
    const firstTab = '.provider-family-tabs [data-family="llm"]';
    const secondTab = '.provider-family-tabs [data-family="system"]';
    await a.bringToFront();
    await a.focus(firstTab);
    await a.keyboard.press('ArrowRight');
    await a.waitForFunction(
      (selector) => document.querySelector(selector) === document.activeElement,
      {},
      secondTab,
    );
    assert.equal(new URL(a.url()).searchParams.get('provider'), ids[0]);
    await a.keyboard.press('Enter');
    await a.waitForFunction(
      (id) => new URL(location.href).searchParams.get('provider') === id,
      {},
      ids[1],
    );
    await a.waitForFunction(
      (selector) => document.querySelector(selector)?.getAttribute('aria-selected') === 'true',
      {},
      secondTab,
    );
    await a.goBack();
    await a.waitForFunction(
      (id) => new URL(location.href).searchParams.get('provider') === id,
      {},
      ids[0],
    );
    await a.waitForFunction(
      (selector) => document.querySelector(selector)?.getAttribute('aria-selected') === 'true',
      {},
      firstTab,
    );
    assert.equal(new URL(a.url()).searchParams.get('tab'), 'capacity');

    await fill(a, 'max_parallel', 1);
    await fill(a, 'queue_capacity', 1);
    await fill(a, 'queue_timeout_seconds', 10);
    await save(a);
    await b.goto(url, { waitUntil: 'networkidle0' });
    await server.unlock(b);
    await b.waitForSelector('.provider-capacity input');
    assert.equal(await b.$eval('input[name="max_parallel"]', (n) => n.value), '1');
    await fill(b, 'max_parallel', 3);
    await a.bringToFront();
    await fill(a, 'max_parallel', 2);
    await save(a);
    await b.bringToFront();
    await b.waitForFunction(() =>
      document
        .querySelector('.provider-capacity')
        ?.textContent.includes('다른 곳에서 설정을 변경했습니다'),
    );
    assert.equal(await b.$eval('input[name="max_parallel"]', (n) => n.value), '3');
    await click(b, '최신 설정 확인');
    await b.waitForFunction(() =>
      document
        .querySelector('.provider-capacity')
        ?.textContent.includes('현재 저장된 값은 동시 2개'),
    );
    await save(b);
    assert.equal((await get(ids[0])).max_parallel, 3);
    await a.bringToFront();
    await a.reload({ waitUntil: 'networkidle0' });
    await server.unlock(a);
    await fill(a, 'max_parallel', 1);
    await save(a);
    const first = request(ids[0]);
    await waitFor(() => calls === 1);
    const second = request(ids[0]);
    await waitFor(async () => (await get(ids[0])).queued === 1);
    assert.equal((await request(ids[0])).status, 429);
    await a.waitForFunction(() =>
      [...document.querySelectorAll('.capacity-live dd')].every((n) => n.textContent === '1개'),
    );
    await a.evaluate(async () => {
      await document.fonts.ready;
      window.scrollTo(0, 0);
    });
    await a.screenshot({
      path: path.join(projectRoot, 'mock/captures/folio/admin-capacity-production.png'),
      fullPage: true,
    });
    // Independent native decision connection still admits a request while the LLM queue is full.
    const native = fetch(
      `${server.base}/api/v1/admin/decisions/${ids[1]}/evaluate`,
      json('POST', {
        expected_version: 1,
        batch: {
          state: 'Contents',
          questions: {
            toc: {
              type: 'choice',
              instructions: 'Is this a table of contents?',
              criteria: { 0: 'No', 1: 'Yes' },
            },
          },
        },
      }),
    );
    await waitFor(() => calls === 2);
    hold = false;
    waiting.splice(0).forEach((send) => send());
    for (const response of await Promise.all([first, second, native]))
      assert.equal(response.status, 200);
    await waitFor(async () => (await get(ids[0])).active === 0);
    await a.goto(`${server.base}/home/admin?provider=${ids[1]}&tab=capacity`, {
      waitUntil: 'networkidle0',
    });
    await server.unlock(a);
    await a.waitForSelector('.provider-capacity input');
    await fill(a, 'max_parallel', 256);
    await fill(a, 'queue_capacity', 1024);
    await save(a);
    assert.equal((await get(ids[1])).max_parallel, 256);
    await fill(a, 'max_parallel', 1025);
    await click(a, '처리 설정 저장');
    assert.equal(await a.$eval('input[name="max_parallel"]', (n) => n.validity.valid), false);
    assert.equal((await get(ids[1])).max_parallel, 256);
    await click(a, '입력 취소');
    let capacityReads = 0;
    a.on('request', (r) => {
      if (r.url().endsWith('/capacity') && r.method() === 'GET') capacityReads++;
    });
    await click(a, '연결 설정', 'tab');
    await delay(100);
    const before = capacityReads;
    await delay(3200);
    assert.equal(capacityReads, before);
    await click(a, '처리 설정', 'tab');
    await a.setViewport({ width: 390, height: 844 });
    await a.waitForFunction(() => {
      const list = document.querySelector('.provider-family-tabs');
      const selected = list?.querySelector('[aria-selected="true"]');
      if (!list || !selected) return false;
      const bounds = list.getBoundingClientRect(),
        item = selected.getBoundingClientRect();
      return item.left >= bounds.left - 1 && item.right <= bounds.right + 1;
    });
    assert.equal(
      await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      true,
    );
    await a.screenshot({
      path: path.join(projectRoot, 'mock/captures/folio/admin-capacity-phone.png'),
      fullPage: true,
    });
    const sent = calls;
    await server.stop();
    await server.start();
    await a.reload({ waitUntil: 'networkidle0' });
    await server.unlock(a);
    await a.waitForSelector('.provider-capacity input');
    assert.equal(await a.$eval('input[name="max_parallel"]', (n) => n.value), '256');
    assert.equal((await get(ids[1])).queue_capacity, 1024);
    assert.equal(calls, sent);
    assert.deepEqual(errors, []);
    console.log(
      'PASS: shared LLM/System One capacity, CAS draft review, actual queue/full rejection, independent connections, live counts, native validation, hidden polling, mobile and restart.',
    );
  } finally {
    hold = false;
    waiting.splice(0).forEach((send) => send());
    if (session) await session.close();
    await server.close();
    model.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
