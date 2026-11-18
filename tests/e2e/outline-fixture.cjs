// Purpose: Serve a deterministic outline LLM contract for real-browser authoring verification.
// Pattern: Synthetic JSON proposals reference only the supplied block/section aliases.
// Usage: outlines.cjs owns server closure; no cloud credentials or real source documents.
// Related: backend/tests/outline_support/, features/outlines/.
const http = require('node:http');
const assert = require('node:assert/strict');
const { authorizedFetch: fetch } = require('./admin-client.cjs');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
async function model(options = {}) {
  let calls = 0;
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/models') {
      res.end(JSON.stringify({ data: [{ id: 'outline-fixture' }] }));
      return;
    }
    assert.equal(req.url, '/v1/chat/completions');
    let body = '';
    for await (const part of req) body += part;
    const input = JSON.parse(body);
    const context = JSON.parse(input.messages[1].content);
    if (context.state && context.questions) {
      const answers = Object.fromEntries(
        Object.keys(context.questions).map((key) => [key, { type: 'choice', choice: '0' }]),
      );
      res.end(
        JSON.stringify({
          choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ answers }) } }],
        }),
      );
      return;
    }
    calls++;
    await options.beforeCall?.(context, input);
    const source = context.source_excerpts;
    let output;
    if (context.task === 'slide_edit') {
      const changes = {};
      const visual = /차트|도형|객체|이미지/.test(context.user_request);
      for (const field of context.selected_fields)
        changes[field] = visual
          ? ['objects', 'layout'].includes(field)
            ? require('./object-fixture.cjs')(context)[field]
            : null
          : field === 'title'
            ? '검증 완료'
            : null;
      output = { tool: 'propose_slide_patch', message: '선택한 내용을 수정했습니다.', changes };
    } else if (context.task === 'presentation_slide')
      output = {
        schema_version: 1,
        title: context.section.title,
        bullets: ['원문에서 확인한 업무 현황', '검토한 근거를 바탕으로 실행 계획을 정리합니다.'],
        notes: '발표 전에 수치와 근거를 확인합니다.',
        block_ids: [context.sources[0].id],
      };
    else if (context.task === 'generate')
      output = {
        nodes: [
          {
            key: 'root',
            parent_key: '',
            title: '업무 현황',
            description: '전체 이야기',
            block_keys: [],
          },
          {
            key: 'summary',
            parent_key: 'root',
            title: '현황 요약',
            description: '현재 상황',
            block_keys: [source[0].key],
          },
          {
            key: 'plan',
            parent_key: 'root',
            title: '실행 계획',
            description: '후속 조치',
            block_keys: [source[1].key],
          },
        ],
      };
    else
      output = {
        assignments: source.map((b, i) => ({
          block_key: b.key,
          node_keys:
            i === 0 && context.sections.length > 1
              ? context.sections.slice(0, 2).map((n) => n.key)
              : [context.sections[i % context.sections.length].key],
        })),
      };
    if (context.task === 'presentation_slide' && context.template?.layouts?.length) {
      output.schema_version = 4;
      output.design = { layout_key: context.template.layouts[0].key, authored: false, objects: [] };
    }
    res.end(
      JSON.stringify({
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }],
        usage: { prompt_tokens: 100, completion_tokens: 100 },
      }),
    );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    base: `http://127.0.0.1:${server.address().port}/v1`,
    calls: () => calls,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
async function json(base, path, method = 'GET', body) {
  const response = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const value = await response.json();
  assert.ok(response.ok, JSON.stringify(value));
  return value;
}
module.exports = { model, json };
