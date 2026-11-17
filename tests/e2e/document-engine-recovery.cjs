// Purpose: Verify document-engine crash recovery and shared results through a real compiled server/UI.
// Pattern: Synthetic local model, held second batch, SIGKILL of test-owned app and retained storage.
// Usage: After pnpm build; QA storage only, no business documents or external inference.
// Related: server.cjs, document_workflows.rs, workflow progress captures.
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { createServer } = require('./server.cjs');
const { json } = require('./outline-fixture.cjs');
const { openBrowser, projectRoot } = require('../helpers/browser.cjs');
async function poll(read, done) {
  const end = Date.now() + 90000;
  while (Date.now() < end) {
    const v = await read();
    if (done(v)) return v;
    await delay(100);
  }
  throw Error('document checkpoint timeout');
}
(async () => {
  const server = await createServer('document-engine-crash-');
  let browser, release;
  let calls = 0,
    pause = true;
  const models = [],
    batches = [];
  const model = http.createServer(async (req, res) => {
    try {
      let raw = '';
      for await (const part of req) raw += part;
      const body = JSON.parse(raw);
      const input = JSON.parse(body.messages[1].content);
      calls++;
      models.push(body.model);
      batches.push(Object.values(input.state.regions).map((v) => v.text));
      if (calls === 2 && pause)
        await new Promise((resolve) => {
          release = resolve;
        });
      const answers = Object.fromEntries(
        Object.keys(input.questions).map((k) => [k, { type: 'choice', choice: '0' }]),
      );
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ answers }) } }],
          usage: { prompt_tokens: 20, completion_tokens: 10 },
        }),
      );
    } catch {
      res.writeHead(500).end();
    }
  });
  model.listen(0, '127.0.0.1');
  await once(model, 'listening');
  try {
    await server.start();
    const provider = randomUUID();
    const config = (version, modelName) => ({
      expected_version: version,
      name: '문서 정리 AI',
      provider_type: 'lm_studio',
      base_url: `http://127.0.0.1:${model.address().port}/v1`,
      model_identifier: modelName,
      timeout_seconds: 60,
      enabled: true,
    });
    await json(
      server.base,
      `/api/v1/admin/llm/providers/${provider}`,
      'PUT',
      config(0, 'original-fixture'),
    );
    await json(server.base, '/api/v1/admin/document-processing/settings', 'PUT', {
      expected_version: 0,
      connection_id: provider,
    });
    const contents =
      '# Engine crash acceptance\n\n' +
      Array.from(
        { length: 40 },
        (_, i) => `Paragraph ${i}: documentworkflowneedle scope and schedule.`,
      ).join('\n\n');
    const form = new FormData();
    form.set('title', '복구 확인 자료');
    form.set('tags', '[]');
    form.set('file', new Blob([contents]), 'recovery.md');
    const uploaded = await fetch(server.base + '/api/v1/space/references', {
      method: 'POST',
      headers: { 'Idempotency-Key': randomUUID() },
      body: form,
    });
    assert.equal(uploaded.status, 201);
    const item = await uploaded.json();
    const read = () => json(server.base, `/api/v1/space/references/${item.id}/processing`);
    const processing = await poll(read, (d) => {
      assert.notEqual(d.job.status, 'failed', JSON.stringify(d));
      return calls === 2 && d.job.completed_blocks === 16;
    });
    browser = await openBrowser('document-engine-recovery');
    const a = await (await browser.browser.createBrowserContext()).newPage();
    const errors = [];
    a.on('pageerror', (e) => errors.push(e.message));
    await a.setViewport({ width: 1440, height: 1000 });
    await a.goto(server.base + '/home/space/library', { waitUntil: 'networkidle0' });
    await a.waitForSelector('.space-title-button');
    await a.click('.space-title-button');
    await a.waitForSelector('.processing-stages [aria-current="step"]');
    assert((await a.$eval('.processing-stages', (n) => n.textContent)).includes('내용 정리'));
    await a.screenshot({
      path: path.join(
        projectRoot,
        'tests/.artifacts/captures/folio/document-engine-classifying.png',
      ),
    });
    await json(
      server.base,
      `/api/v1/admin/llm/providers/${provider}`,
      'PUT',
      config(1, 'changed-default'),
    );
    await server.crash();
    pause = false;
    release?.();
    await server.start();
    const done = await poll(read, (d) => {
      assert.notEqual(d.job.status, 'failed', JSON.stringify(d));
      return d.job.status === 'succeeded';
    });
    assert.equal(done.job.id, processing.job.id);
    assert.equal(done.job.extraction_id, processing.job.extraction_id);
    assert.equal(done.job.config_id, processing.job.config_id);
    assert.equal(done.job.completed_blocks, done.job.total_blocks);
    assert.equal(done.job.steps[0].attempt, 1);
    assert.equal(done.job.steps[1].attempt, 2);
    assert(done.job.steps.every((s) => s.state === 'succeeded'));
    assert(models.every((m) => m === 'original-fixture'));
    const completed = new Set(batches[0]);
    assert(batches.slice(2).every((batch) => batch.every((text) => !completed.has(text))));
    await a.reload({ waitUntil: 'networkidle0' });
    await a.waitForSelector('.space-title-button');
    await a.click('.space-title-button');
    await a.waitForFunction(
      () =>
        document.querySelectorAll('.processing-stages li').length === 3 &&
        [...document.querySelectorAll('.processing-stages li')].every((n) =>
          n.textContent.includes('완료'),
        ),
    );
    await a.screenshot({
      path: path.join(projectRoot, 'tests/.artifacts/captures/folio/document-engine-recovered.png'),
    });
    const b = await (await browser.browser.createBrowserContext()).newPage();
    await b.goto(server.base + '/home/space/library', { waitUntil: 'networkidle0' });
    await b.waitForSelector('.space-title-button');
    await b.click('.space-title-button');
    await b.waitForSelector('.processing-stages');
    assert.equal(await b.$('.work-dock'), null);
    const search = await json(
      server.base,
      '/api/v1/search?q=documentworkflowneedle&scope=references&mode=content',
    );
    assert.equal(search.total, 1);
    const prior = calls;
    await server.stop();
    await server.start();
    assert.equal((await read()).job.status, 'succeeded');
    await delay(1000);
    assert.equal(calls, prior);
    assert.deepEqual(errors, []);
    console.log(
      `PASS: document engine SIGKILL/restart, pinned model, ${done.job.completed_blocks} decisions, no replay of committed batches, shared browser/search and completed extraction reuse`,
    );
  } finally {
    release?.();
    if (browser) await browser.close();
    await server.close();
    model.closeAllConnections();
    await new Promise((resolve) => model.close(resolve));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
