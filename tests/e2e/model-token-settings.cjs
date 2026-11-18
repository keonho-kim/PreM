// Purpose: Verify explicit load, versioned token limits and actual per-instance decision routing.
// Pattern: Admin browser with a recording LM Studio fixture and isolated PreM storage.
// Usage: pnpm test:e2e model-token-settings after building the application.
// Related: model-token-fields.tsx, model_load.rs, lm_load.rs.
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const { createServer } = require('./server.cjs');
const { json } = require('./outline-fixture.cjs');
const { openBrowser } = require('../helpers/browser.cjs');
const { clickRole } = require('../helpers/interactions.cjs');
(async () => {
  const app = await createServer('token-settings-');
  const instances = [{ id: 'sample', config: { physical_batch_size: 512, context_length: 16384 } }];
  let session,
    loads = 0,
    executed;
  const fixture = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/v1/models') {
      res.end(
        JSON.stringify({
          models: [
            {
              key: 'sample',
              type: 'decision',
              max_context_length: 32768,
              loaded_instances: instances,
            },
          ],
        }),
      );
      return;
    }
    let raw = '';
    for await (const part of req) raw += part;
    const body = JSON.parse(raw);
    if (req.url === '/api/v1/models/load') {
      assert.equal(body.model, 'sample');
      assert.equal(body.eval_batch_size, 8192);
      assert.equal(body.physical_batch_size, 8192);
      const config = { physical_batch_size: 8192, context_length: body.context_length };
      instances.push({ id: 'sample:2', config });
      loads++;
      res.end(JSON.stringify({ status: 'loaded', instance_id: 'sample:2', load_config: config }));
      return;
    }
    assert.equal(req.url, '/v1/systemone');
    executed = body.model;
    res.end(
      JSON.stringify({
        model: body.model,
        answers: {
          q: { type: 'choice', choice: '1', probabilities: { 0: 0, 1: 1 }, confidence: 1 },
        },
      }),
    );
  });
  try {
    fixture.listen(0, '127.0.0.1');
    await once(fixture, 'listening');
    await app.start();
    const id = randomUUID(),
      path = '/api/v1/admin/llm/providers/' + id;
    await json(app.base, path, 'PUT', {
      expected_version: 0,
      name: 'Decision sample',
      provider_type: 'lm_studio_decision',
      base_url: `http://127.0.0.1:${fixture.address().port}/v1`,
      model_identifier: 'sample',
      timeout_seconds: 30,
      enabled: true,
    });
    session = await openBrowser('model-tokens');
    const page = await session.browser.newPage();
    await page.goto(app.base + '/home/admin?section=decision&provider=' + id);
    await app.unlock(page);
    await page.locator('input[name=context_length]').fill('16384');
    await page.locator('input[name=physical_batch_size]').fill('8192');
    await clickRole(page, '변경 사항 저장');
    await clickRole(page, '확인하고 저장');
    await page.waitForSelector('button::-p-text(저장한 토큰 설정으로 모델 준비)', {
      visible: true,
    });
    assert.equal(loads, 0);
    await clickRole(page, '저장한 토큰 설정으로 모델 준비');
    await page.waitForFunction(() => document.body.innerText.includes('준비된 모델: sample:2'));
    assert.equal(loads, 1);
    const repeat = await json(app.base, path + '/prepare', 'POST', { expected_version: 2 });
    assert.equal(repeat.instance_id, 'sample:2');
    assert.equal(loads, 1);
    await app.stop();
    await app.start();
    const saved = await json(app.base, path);
    assert.equal(saved.physical_batch_size, 8192);
    assert.equal(saved.context_length, 16384);
    await json(app.base, '/api/v1/admin/decisions/' + id + '/evaluate', 'POST', {
      expected_version: 2,
      batch: {
        state: 'sample',
        questions: {
          q: { type: 'choice', instructions: 'Select one.', criteria: { 0: 'No', 1: 'Yes' } },
        },
      },
    });
    assert.equal(executed, 'sample:2');
    console.log(
      'PASS: saved physical batch and context, explicit instance preparation, reuse and pinned routing after restart.',
    );
  } finally {
    if (session) await session.close();
    await app.close();
    fixture.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
