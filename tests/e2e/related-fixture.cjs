// Purpose: Own a synthetic native Decision endpoint and isolated project originals for browser tests.
// Pattern: Actual product HTTP and text fixtures; no production configuration or model downloads.
// Usage: related-documents.cjs closes the fixture after the product server.
// Related: backend/tests/relation_support/, server.cjs.
const http = require('node:http');
const assert = require('node:assert/strict');
const { authorizedFetch: fetch } = require('./admin-client.cjs');
const fs = require('node:fs');
const path = require('node:path');
const { projectRoot } = require('../../mock/helpers/browser.cjs');
async function model() {
  const state = { calls: 0, plannerCalls: 0 };
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET') {
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            models: [
              {
                type: 'decision',
                key: 'fixture-relations',
                loaded_instances: [{ id: 'fixture-relations' }],
              },
            ],
          }),
        );
        return;
      }
      let text = '';
      for await (const chunk of req) text += chunk;
      assert.ok(Buffer.byteLength(text) < 32768);
      const body = JSON.parse(text);
      if (body.messages) {
        state.plannerCalls++;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            choices: [
              {
                finish_reason: 'stop',
                message: { content: JSON.stringify({ queries: ['BRIDGE_TOKEN'] }) },
              },
            ],
            usage: { prompt_tokens: 100, completion_tokens: 10 },
          }),
        );
        return;
      }
      assert.ok(body.state.current);
      state.calls++;
      await new Promise((r) => setTimeout(r, 180));
      const answers = {};
      for (const key of Object.keys(body.questions)) {
        const c = body.state.candidates[key].text;
        const choice = c.includes('NEEDS_MORE')
          ? '5'
          : c.includes('clearer responsibilities')
            ? '3'
            : '2';
        answers[key] = {
          type: 'choice',
          choice,
          confidence: 0.9,
          probabilities: Object.fromEntries(
            Array.from({ length: 6 }, (_, i) => [String(i), String(i) === choice ? 0.9 : 0.02]),
          ),
        };
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          model: body.model,
          answers,
          usage: { input_tokens: 100, output_tokens: 10 },
        }),
      );
    } catch (error) {
      res.statusCode = 500;
      res.end(String(error));
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    state,
    base: `http://127.0.0.1:${server.address().port}/v1`,
    close: () => new Promise((r) => server.close(r)),
  };
}
async function json(base, path, method = 'GET', value) {
  const response = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    ...(value ? { body: JSON.stringify(value) } : {}),
  });
  const data = await response.json();
  assert.ok(response.ok, JSON.stringify(data));
  return data;
}
async function project(base, name) {
  return json(base, '/api/v1/projects', 'POST', { name, due_date: '2030-01-01' });
}
async function upload(base, p, name, bytes, target) {
  const form = new FormData();
  form.set('file', new Blob([bytes]), name);
  form.set('title', name);
  form.set('tags', '[]');
  const response = await fetch(
    `${base}/api/v1/projects/${p}/files${target ? `/${target.item_id}/versions` : ''}`,
    {
      method: 'POST',
      headers: {
        'Idempotency-Key': crypto.randomUUID(),
        ...(target ? { 'X-Expected-Version': String(target.item_version) } : {}),
      },
      body: form,
    },
  );
  const value = await response.json();
  assert.ok(response.ok, JSON.stringify(value));
  return value;
}
async function ready(base, p, item) {
  for (let i = 0; i < 600; i++) {
    const d = await json(base, `/api/v1/projects/${p}/files/${item.id}/processing`);
    if (d.job.extraction_id) return;
    assert.notEqual(d.job.status, 'failed', JSON.stringify(d));
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('extraction timeout');
}
async function seed(base, modelBase) {
  const target = await project(base, '현재 업무 개선 보고');
  const source = await upload(
    base,
    target.id,
    '현재 계획.html',
    '<!DOCTYPE html><html><body><h1>Current goals</h1><p>Current efficiency improvement plan for customer support operations.</p></body></html>',
  );
  const original =
    '<!DOCTYPE html><html><body><h1>Operations</h1><p>efficiency evidence: measured response time improved in the previous project. Review the actual conditions before reuse.</p></body></html>';
  const a = await project(base, '고객 지원 개선'),
    b = await project(base, '운영 혁신 사례'),
    c = await project(base, '업무 프로세스 설계'),
    d = await project(base, '정기 업무 보고');
  const inputs = [
    [a, '이전 운영 보고서.html', original],
    [b, '이전 운영 보고서.html', original],
    [
      c,
      '프로세스 설계.html',
      '<!DOCTYPE html><html><body><p>An approach to redesigning work procedures with clearer responsibilities and review cycles.</p></body></html>',
    ],
    [
      d,
      '정기 보고.pdf',
      fs.readFileSync(path.join(projectRoot, 'tests/fixtures/documents/text.pdf')),
    ],
  ];
  const uploads = [];
  for (const [p, name, bytes] of inputs) uploads.push([p, await upload(base, p.id, name, bytes)]);
  await ready(base, target.id, source);
  for (const [p, item] of uploads) await ready(base, p.id, item);
  const provider = crypto.randomUUID();
  await json(base, `/api/v1/admin/llm/providers/${provider}`, 'PUT', {
    expected_version: 0,
    name: '자료 비교 AI',
    provider_type: 'lm_studio_decision',
    base_url: modelBase,
    model_identifier: 'fixture-relations',
    timeout_seconds: 30,
    enabled: true,
  });
  return { target, original, provider };
}
module.exports = { model, json, upload, seed, ready };
