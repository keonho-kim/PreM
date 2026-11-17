// Purpose: Verify shared Studio mapping steps, cancellation and crash recovery through real UI.
// Pattern: Held synthetic model batches and a SIGKILL of the test-owned compiled application.
// Usage: After pnpm build; all source data and server storage are disposable QA inputs.
// Related: server.cjs, outline-fixture.cjs, backend/tests/outline_workflows.rs.
const assert = require('node:assert/strict');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { createServer } = require('./server.cjs');
const { model, json } = require('./outline-fixture.cjs');
const { openBrowser, projectRoot } = require('../../mock/helpers/browser.cjs');
async function poll(read, done) {
  const end = Date.now() + 60000;
  while (Date.now() < end) {
    const value = await read();
    if (done(value)) return value;
    await delay(100);
  }
  throw Error('outline workflow checkpoint timeout');
}
async function click(page, name, role = 'button') {
  const item = await page.waitForSelector(`::-p-aria(${name}[role="${role}"])`, { visible: true });
  await item.evaluate((n) => n.scrollIntoView({ block: 'center' }));
  await item.click();
}
async function capture(page, name) {
  await page.evaluate(() =>
    document.querySelector('.outline-workflow-status').scrollIntoView({ block: 'center' }),
  );
  await page.screenshot({ path: path.join(projectRoot, 'mock/captures/folio', name) });
}
(async () => {
  const server = await createServer('outline-engine-crash-');
  let browser,
    release,
    hold = true;
  const batches = [],
    models = [];
  const fixture = await model({
    beforeCall: async (context, request) => {
      models.push(request.model);
      if (context.task !== 'map') return;
      batches.push(context.source_excerpts.map((b) => b.text));
      if (batches.length > 1 && hold)
        await new Promise((resolve) => {
          release = resolve;
        });
    },
  });
  try {
    await server.start();
    const provider = randomUUID();
    const config = (version, name) => ({
      expected_version: version,
      name: '목차 작성 AI',
      provider_type: 'openai_compatible',
      base_url: fixture.base,
      model_identifier: name,
      timeout_seconds: 60,
      enabled: true,
    });
    await json(
      server.base,
      `/api/v1/admin/llm/providers/${provider}`,
      'PUT',
      config(0, 'outline-fixture'),
    );
    const project = await json(server.base, '/api/v1/projects', 'POST', {
      name: '발표 구성 복구',
      due_date: '2030-01-01',
    });
    const p = project.id;
    const form = new FormData();
    form.set('title', '업무 보고서');
    form.set(
      'file',
      new Blob([
        Array.from({ length: 22 }, (_, i) => `업무 내용 ${i}: 현황과 개선 계획을 설명합니다.`).join(
          '\n\n',
        ),
      ]),
      'source.md',
    );
    const uploaded = await fetch(server.base + `/api/v1/projects/${p}/files`, {
      method: 'POST',
      headers: { 'Idempotency-Key': randomUUID() },
      body: form,
    });
    assert.equal(uploaded.status, 201, await uploaded.text());
    const review = await poll(
      () => json(server.base, `/api/v1/projects/${p}/source-review`),
      (s) => s.ready,
    );
    await json(server.base, `/api/v1/projects/${p}/source-review`, 'PUT', {
      snapshot: review.snapshot,
    });
    await json(server.base, `/api/v1/projects/${p}/guide`, 'PUT', {
      expected_version: 0,
      do_text: '실행 계획을 강조',
      dont_text: '근거 없는 수치 제외',
    });
    const read = () => json(server.base, `/api/v1/projects/${p}/outline`);
    const base = await read();
    await json(server.base, `/api/v1/projects/${p}/outline/runs`, 'POST', {
      expected_version: base.version,
      source_snapshot: base.source_snapshot,
      guide_version: base.guide_version,
      connection_id: provider,
      model_version: 1,
      kind: 'generate',
      node_ids: [],
    });
    const generated = await poll(read, (s) => s.run.status === 'succeeded');
    browser = await openBrowser('outline-engine-recovery');
    const a = await (await browser.browser.createBrowserContext()).newPage();
    const b = await (await browser.browser.createBrowserContext()).newPage();
    const errors = [];
    for (const page of [a, b]) page.on('pageerror', (e) => errors.push(e.message));
    await a.setViewport({ width: 1440, height: 1000 });
    const route = server.base + `/home/studio/${p}?step=outline`;
    await a.goto(route, { waitUntil: 'networkidle0' });
    await click(a, 'AI로 구성');
    await click(a, '전체 내용 자동 연결');
    const running = await poll(read, (s) => s.run.completed === 1 && batches.length === 2);
    assert.equal(running.version, generated.version);
    await a.waitForFunction(() =>
      document.querySelector('.outline-workflow-status')?.textContent.includes('1 / 3개 묶음 완료'),
    );
    await capture(a, 'outline-engine-mapping.png');
    await b.goto(route, { waitUntil: 'networkidle0' });
    await b.waitForSelector('.outline-workflow-status [aria-current="step"]');
    assert.equal(await b.$('.work-dock'), null);
    await click(a, '작업 취소');
    const cancelled = await poll(read, (s) => s.run.status === 'cancelled');
    assert.equal(cancelled.version, generated.version);
    release?.();
    await a.waitForFunction(() =>
      document.querySelector('.outline-run')?.textContent.includes('작업을 취소했습니다'),
    );
    await capture(a, 'outline-engine-cancelled.png');
    await click(a, '작업 이어하기');
    await poll(
      read,
      (s) => s.run.status === 'running' && s.run.completed === 1 && batches.length === 3,
    );
    await json(
      server.base,
      `/api/v1/admin/llm/providers/${provider}`,
      'PUT',
      config(1, 'changed-default'),
    );
    await server.crash();
    hold = false;
    release?.();
    await server.start();
    const recovered = await poll(read, (s) => {
      assert.notEqual(s.run.status, 'failed', JSON.stringify(s));
      return s.run.status === 'succeeded';
    });
    assert.equal(recovered.run.id, running.run.id);
    assert.equal(recovered.version, generated.version + 1);
    assert.equal(recovered.run.completed, recovered.run.total);
    assert.equal(recovered.run.steps[0].attempt, 3);
    assert.equal(recovered.run.steps[1].attempt, 1);
    assert(recovered.run.steps.every((s) => s.state === 'succeeded'));
    const completed = new Set(batches[0]);
    assert(batches.slice(1).every((batch) => batch.every((text) => !completed.has(text))));
    assert(models.every((name) => name === 'outline-fixture'));
    await a.reload({ waitUntil: 'networkidle0' });
    await a.waitForFunction(
      () =>
        document.querySelectorAll('.outline-workflow-status li').length === 2 &&
        [...document.querySelectorAll('.outline-workflow-status li')].every((n) =>
          n.textContent.includes('완료'),
        ),
    );
    await capture(a, 'outline-engine-recovered.png');
    await a.setViewport({ width: 390, height: 844 });
    await capture(a, 'outline-engine-phone.png');
    assert(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await b.reload({ waitUntil: 'networkidle0' });
    await b.waitForSelector('.outline-workflow-status');
    assert(
      (await b.$eval('.outline-workflow-status', (n) => n.textContent)).includes(
        '자동 구성을 마쳤습니다',
      ),
    );
    const prior = fixture.calls();
    await server.stop();
    await server.start();
    assert.equal((await read()).revision_id, recovered.revision_id);
    await delay(700);
    assert.equal(fixture.calls(), prior);
    assert.equal((await json(server.base, '/api/v1/space/all')).total, 0);
    assert.deepEqual(errors, []);
    console.log(
      'PASS: common outline engine stages, UI cancel/resume, SIGKILL recovery, committed batch reuse, pinned model, shared revision, mobile and restart without re-generation',
    );
  } finally {
    hold = false;
    release?.();
    if (browser) await browser.close();
    await server.close();
    await fixture.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
