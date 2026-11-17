// Purpose: Explicitly validate the selected local LM Studio model through the product adapter.
// Pattern: Opt-in endpoint/model with isolated application data and sanitized acceptance output.
// Usage: Set PREM_LIVE_LLM_URL and PREM_LIVE_LLM_MODEL; run after pnpm build.
// Related: providers.cjs, server.cjs; never runs as part of the ordinary test suite.
const assert = require('node:assert/strict');
const { authorizedFetch: fetch } = require('./admin-client.cjs');
const { randomUUID } = require('node:crypto');
const { createServer } = require('./server.cjs');
(async () => {
  const base = process.env.PREM_LIVE_LLM_URL,
    model = process.env.PREM_LIVE_LLM_MODEL;
  assert.ok(base && model, 'Explicit LM endpoint and model are required');
  const protocol = process.env.PREM_LIVE_LLM_PROTOCOL ?? 'lm_studio';
  assert.ok(['lm_studio', 'lm_studio_native'].includes(protocol));
  const server = await createServer('provider-live-');
  try {
    await server.start();
    const root = server.base + '/api/v1/admin/llm/providers/' + randomUUID();
    const call = async (method, url, body) => {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(190000),
      });
      const value = await res.json();
      assert.equal(res.status, 200, JSON.stringify(value));
      return value;
    };
    const config = await call('PUT', root, {
      expected_version: 0,
      name: 'LM Studio acceptance',
      provider_type: protocol,
      base_url: base,
      model_identifier: model,
      timeout_seconds: 180,
      enabled: true,
    });
    const models = await call('GET', root + '/models?expected_version=1');
    assert.ok(models.includes(model));
    for (const kind of protocol === 'lm_studio_native' ? ['text'] : ['text', 'structured']) {
      console.log('Running live model check:', kind, model);
      const result = await call('POST', root + '/test', { expected_version: 1, kind });
      assert.equal(result.request.config_id, config.config_id);
      console.log(JSON.stringify({ kind, ...result.request, text: result.text }));
    }
    console.log('PASS: selected LM Studio protocol', protocol, 'model', model);
  } finally {
    await server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
