// Purpose: Exercise inline provider setup, native discovery and shared settings on the real server.
// Pattern: Isolated database, synthetic local model endpoints, independent browsers and restart.
// Usage: Run after pnpm build; credentials and uploads never reach real application storage.
// Related: admin-navigation.cjs, server.cjs, frontend/features/providers/.
const { setViewport, clickRole } = require('../helpers/interactions.cjs');
const assert = require('node:assert/strict');
const { authorizedFetch: fetch } = require('./admin-client.cjs');
const { startModelServer } = require('./provider-server.cjs');
const path = require('node:path');
const { openBrowser, projectRoot } = require('../helpers/browser.cjs');
const { createServer } = require('./server.cjs');
const { adminNavigation } = require('./admin-navigation.cjs');
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
async function choose(page, label, option) {
  await click(page, label, 'combobox');
  await click(
    page,
    label === '사용할 모델 · 필수'
      ? option + (option === 'd3-flash-artemis' ? ' · Decision' : ' · LLM')
      : option,
    'option',
  );
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
  await page.waitForNetworkIdle({ idleTime: 250 });
}
async function field(page, name, value) {
  if (['base_url', 'api_key'].includes(name) && !(await page.$(`input[name="${name}"]`)))
    await click(page, '연결 주소·인증 변경');
  const input = await page.waitForSelector(`input[name="${name}"]`, { visible: true });
  await input.evaluate((e) => e.select());
  await page.keyboard.press('Backspace');
  await input.type(value);
}
async function openOptions(page) {
  const input = await page.$('input[name="timeout_seconds"]');
  if (!input || !(await input.boundingBox())) await click(page, '추가 연결 설정');
}
(async () => {
  const model = await startModelServer();
  const { endpoint } = model;
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
      await setViewport(p, { width: 1440, height: 1000 });
    }
    await a.goto(server.base + '/home/', { waitUntil: 'networkidle0' });
    await a.waitForSelector('#admin-token');
    assert.equal(new URL(a.url()).searchParams.get('section'), 'llm');
    assert.match(
      await a.$eval('.model-setup-notice', (n) => n.textContent),
      /LLM과 Decision 모델이 아직 설정되지/,
    );
    await server.unlock(a);
    assert.ok(await a.$('::-p-aria(LLM 연결[role="link"])'));
    assert.ok(await a.$('::-p-aria(Decision Model 연결[role="link"])'));
    assert.equal(await a.$('::-p-aria(AI 모델 추가[role="button"])'), null);
    assert.equal(await a.$('input[name="model_identifier"]'), null);
    await choose(a, 'Provider', 'LM Studio · OpenAI 호환');
    await field(a, 'base_url', endpoint + '/v1');
    await field(a, 'api_key', 'qa-key');
    await click(a, '모델 목록 조회');
    await choose(a, '사용할 모델 · 필수', 'ornith-1.5-35b-a3b');
    assert.equal((await list()).length, 0);
    await openOptions(a);
    await field(a, 'max_output_tokens', '30000');
    await field(a, 'timeout_seconds', '600');
    await a.$eval('input[name="max_output_tokens"]', (n) => n.scrollIntoView({ block: 'center' }));
    await a.screenshot({
      path: path.join(projectRoot, 'tests/.artifacts/captures/folio/output-budget-admin.png'),
    });
    assert(await a.$eval('.provider-form button[type=submit]', (b) => b.disabled));
    await choose(a, 'Thinking · 선택', '켜기');
    await a.waitForFunction(
      () =>
        document.querySelector('.thinking-feedback') &&
        !document.querySelector('.provider-form button[type=submit]')?.disabled,
    );
    await choose(a, 'Thinking Effort · 선택', 'xhigh');
    await a.waitForFunction(() =>
      document.querySelector('.provider-form')?.textContent.includes('Thinking만 켭니다.'),
    );
    await require('./draft-probe.cjs').verifyDraft(a);
    await click(a, '설정 저장');
    await a.waitForSelector('.provider-summary');
    const first = (await list())[0];
    assert.equal(first.model_identifier, 'ornith-1.5-35b-a3b');
    assert.equal(first.base_url, endpoint + '/v1/');
    assert.equal(first.max_output_tokens, 30000);
    assert.equal(first.physical_batch_size, 2048);
    assert.equal(first.timeout_seconds, 600);
    assert.equal(first.thinking, true);
    assert.equal(first.thinking_effort, null);
    await a.waitForFunction(() =>
      document.querySelector('.model-setup-notice')?.textContent.startsWith('Decision 모델'),
    );
    model.failNextDiagnostic();
    await click(a, '연결 진단');
    await a.waitForFunction(() =>
      document.querySelector('.connection-diagnostic')?.textContent.includes('연결 진단 실패'),
    );
    await click(a, '연결 진단');
    await a.waitForFunction(() =>
      document.querySelector('.connection-diagnostic')?.textContent.includes('텍스트 응답 확인'),
    );
    await click(a, 'Decision Model 연결', 'link');
    await click(a, '연결 진단');
    await a.waitForFunction(() =>
      document.querySelector('.connection-diagnostic')?.textContent.includes('판정 응답 확인'),
    );
    await a.goBack();
    await a.waitForFunction(() => new URL(location.href).searchParams.get('provider') !== null);
    await click(a, '연결 주소·인증 변경');
    assert.equal(await a.$eval('input[name="base_url"]', (n) => n.value), '');
    assert.equal(await a.$eval('input[name="api_key"]', (n) => n.value), '');
    await click(a, '연결 테스트', 'tab');
    await click(a, '텍스트 테스트');
    await a.waitForFunction(() =>
      document.querySelector('.provider-result')?.textContent.includes('PreM connection OK'),
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
    await openOptions(a);
    await field(a, 'name', '내 연결 설정');
    await require('./draft-probe.cjs').verifyDraft(a);
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
        max_output_tokens: first.max_output_tokens,
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
    await require('./draft-probe.cjs').verifyDraft(a);
    await click(a, '변경 사항 저장');
    await click(a, '확인하고 저장');
    await a.waitForFunction(() =>
      document.querySelector('.provider-summary')?.textContent.includes('내 연결 설정'),
    );
    await click(a, '연결 테스트', 'tab');
    await click(a, '구조화 응답 테스트');
    await a.waitForSelector('.provider-result');
    await adminNavigation(a, first.id, server.unlock);
    await a.screenshot({
      path: path.join(
        projectRoot,
        'tests/.artifacts/captures/folio/admin-providers-production.png',
      ),
      fullPage: true,
    });
    await setViewport(a, { width: 390, height: 844 });
    await a.screenshot({
      path: path.join(projectRoot, 'tests/.artifacts/captures/folio/admin-providers-phone.png'),
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
        document.querySelector('.model-picker [role="status"]')?.textContent.includes('2개 모델'),
      )
      .catch(async (error) => {
        console.log(
          await a.$$eval('.provider-form [role="status"]', (nodes) =>
            nodes.map((node) => node.textContent),
          ),
        );
        throw error;
      });
    await click(a, '저장 전 연결 진단');
    await a.waitForFunction(() =>
      document
        .querySelector('.provider-form .provider-actions [role=status]')
        ?.textContent.includes('인증'),
    );
    assert.equal(await a.$eval('.provider-form button[type=submit]', (b) => b.disabled), true);
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
    await require('./draft-probe.cjs').verifyDraft(a);
    await click(a, '설정 저장');
    await a.waitForFunction(
      () => document.querySelector('#provider-llm')?.textContent === 'LM Studio Native',
    );
    await click(a, '연결 테스트', 'tab');
    await click(a, '텍스트 테스트');
    await a.waitForFunction(() =>
      document.querySelector('.provider-result')?.textContent.includes('PreM connection OK'),
    );
    await click(a, 'Decision Model 연결', 'link');
    await choose(a, 'Provider', 'LM Studio');
    await field(a, 'base_url', endpoint + '/v1');
    await click(a, '모델 목록 조회');
    await choose(a, '사용할 모델 · 필수', 'd3-flash-artemis');
    assert.equal((await list()).length, 2);
    await require('./draft-probe.cjs').verifyDraft(a);
    await click(a, '설정 저장');
    await a.waitForSelector('.provider-summary');
    const decision = (await list()).find((p) => p.provider_type === 'lm_studio_decision');
    assert.equal(decision.model_identifier, 'd3-flash-artemis');
    assert.equal(decision.physical_batch_size, 2048);
    await setViewport(a, { width: 1440, height: 1000 });
    await a.screenshot({
      path: path.join(projectRoot, 'tests/.artifacts/captures/folio/admin-decision-settings.png'),
      fullPage: true,
    });
    await click(a, '연결 진단');
    await a.waitForFunction(() =>
      document.querySelector('.connection-diagnostic')?.textContent.includes('판정 응답 확인'),
    );
    await a.goto(server.base + '/home/', { waitUntil: 'networkidle0' });
    assert.equal(new URL(a.url()).searchParams.get('section'), 'decision');
    await server.unlock(a);
    await click(a, '사용할 판정 연결', 'combobox');
    await click(a, decision.name + ' · System One', 'option');
    await click(a, '판정 연결 적용');
    await a.waitForFunction(() =>
      document.querySelector('.model-setup-notice')?.textContent.includes('설정이 완료'),
    );
    await click(a, 'Home으로 이동', 'link');
    await a.waitForSelector('.projects-empty');
    assert.ok(model.inventoryCalls() >= 4);
    assert.deepEqual(errors, []);
    console.log(
      'PASS: LLM/Decision tabs, native pre-save discovery, loaded model IDs, shared edits, key retention, confirmation/cancel, independent settings, mobile and restart.',
    );
  } finally {
    if (session) await session.close();
    await server.close();
    await model.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
