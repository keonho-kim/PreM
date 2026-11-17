// Purpose: Validate an explicitly selected local LLM as a decision bridge on isolated storage.
// Pattern: Opt-in real model call; no production settings or cloud credentials are read.
// Usage: PREM_LIVE_LLM_URL=http://127.0.0.1:1234/v1 PREM_LIVE_LLM_MODEL=... node tests/e2e/decision-live.cjs.
// Related: server.cjs, backend/modules/decisions/, provider-live.cjs.
const assert = require('node:assert/strict');
const { authorizedFetch: fetch } = require('./admin-client.cjs');
const { randomUUID } = require('node:crypto');
const { createServer } = require('./server.cjs');
(async () => {
  const url = process.env.PREM_LIVE_LLM_URL;
  const model = process.env.PREM_LIVE_LLM_MODEL;
  assert.ok(url && model, 'Explicit live URL and model are required');
  assert.ok(
    ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname),
    'This acceptance script is local-only',
  );
  const server = await createServer('decision-live-');
  try {
    await server.start();
    const id = randomUUID();
    const saved = await fetch(`${server.base}/api/v1/admin/llm/providers/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expected_version: 0,
        name: 'QA local decision bridge',
        provider_type: 'lm_studio',
        base_url: url,
        model_identifier: model,
        enabled: true,
        timeout_seconds: 180,
      }),
    });
    assert.equal(saved.status, 200);
    const question = (region) => ({
      type: 'choice',
      instructions: `Is state.${region} a table of contents?`,
      criteria: {
        0: 'Ordinary body text or an isolated section heading',
        1: 'A list of document sections with page numbers or reading order',
      },
    });
    const response = await fetch(`${server.base}/api/v1/admin/decisions/${id}/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expected_version: 1,
        batch: {
          state: {
            r1: '목차\n1. 사업 개요 ... 3\n2. 추진 계획 ... 8',
            r2: '이 프로젝트는 사내 문서를 분석하고 프레젠테이션을 작성하기 위한 도구다.',
          },
          questions: { toc: question('r1'), body: question('r2') },
        },
      }),
      signal: AbortSignal.timeout(185000),
    });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    assert.equal(result.result.answers.toc.choice, '1');
    assert.equal(result.result.answers.body.choice, '0');
    assert.equal(result.result.statistics, 'unavailable');
    console.log(
      JSON.stringify({
        model,
        elapsed_ms: result.request.elapsed_ms,
        prompt_tokens: result.request.prompt_tokens,
        completion_tokens: result.request.completion_tokens,
        choices: { toc: '1', body: '0' },
      }),
    );
  } finally {
    await server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
