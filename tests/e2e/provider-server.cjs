// Purpose: Serve local model inventory and diagnostic responses for the Admin browser tests.
// Pattern: Explicit protocol fixtures and a one-shot provider outage for the retry journey.
// Usage: providers.cjs starts the server and closes it after the browser journey.
// Related: providers.cjs, admin-navigation.cjs.
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
async function startModelServer() {
  let inventoryCalls = 0;
  let failNextDiagnostic = false;
  const model = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/v1/models') {
      inventoryCalls++;
      res.end(
        JSON.stringify({
          models: [
            {
              type: 'llm',
              key: 'download-model',
              capabilities: { reasoning: { allowed_options: ['off', 'on', 'low', 'high'] } },
              loaded_instances: [
                { id: 'ornith-1.5-35b-a3b', config: { physical_batch_size: 2048 } },
              ],
            },
            {
              type: 'decision',
              key: 'download-decision',
              loaded_instances: [{ id: 'd3-flash-artemis', config: { physical_batch_size: 2048 } }],
            },
            { type: 'embedding', key: 'not-for-this-task' },
          ],
        }),
      );
      return;
    }
    if (req.url === '/v1/chat/completions' && req.headers.authorization !== 'Bearer qa-key') {
      res.writeHead(401).end('{}');
      return;
    }
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    if (['medium', 'xhigh', 'prem_invalid_effort'].includes(body.reasoning_effort)) {
      res.writeHead(400).end('{}');
      return;
    }
    if (req.url === '/v1/systemone') {
      assert.equal(body.model, 'd3-flash-artemis');
      assert.ok(body.questions.category);
      res.end(
        JSON.stringify({
          model: body.model,
          answers: {
            category: {
              type: 'choice',
              choice: '1',
              probabilities: { 0: 0.1, 1: 0.9 },
              confidence: 0.8,
            },
          },
        }),
      );
      return;
    }
    if (failNextDiagnostic && req.url === '/v1/chat/completions') {
      failNextDiagnostic = false;
      res.writeHead(503).end('{}');
      return;
    }
    if (body.response_format?.json_schema?.schema?.properties?.answers) {
      res.end(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'stop',
              message: {
                content: JSON.stringify({ answers: { category: { type: 'choice', choice: '1' } } }),
              },
            },
          ],
        }),
      );
      return;
    }
    if (req.url === '/api/v1/chat') {
      res.end(
        JSON.stringify({
          output: [{ type: 'message', content: 'PreM connection OK' }],
          stats: { input_tokens: 12, total_output_tokens: 5 },
        }),
      );
      return;
    }
    res.end(
      JSON.stringify({
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: body.response_format ? '{"status":"ok"}' : 'PreM connection OK',
            },
          },
        ],
        usage: { prompt_tokens: 12, completion_tokens: 5 },
      }),
    );
  });
  model.listen(0, '127.0.0.1');
  await once(model, 'listening');
  const endpoint = `http://127.0.0.1:${model.address().port}`;
  return {
    endpoint,
    inventoryCalls: () => inventoryCalls,
    failNextDiagnostic: () => {
      failNextDiagnostic = true;
    },
    close: async () => {
      model.closeAllConnections();
      await new Promise((resolve) => model.close(resolve));
    },
  };
}
module.exports = { startModelServer };
