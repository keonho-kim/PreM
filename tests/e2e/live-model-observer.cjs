// Purpose: Observe visible local-model responses during opt-in public-fixture acceptance.
// Pattern: Protocol-preserving loopback relay; never record reasoning, prompts or credentials.
// Usage: Owned by presentation-live.cjs; close on every success/failure path.
// Related: native-edit-trace.cjs, tests/.artifacts/presentation-live/model-responses.json.
const http = require('node:http');
const fs = require('node:fs/promises');
const { once } = require('node:events');
module.exports = async function observe(endpoint, file) {
  const origin = new URL(endpoint);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname))
    throw Error('Local model required');
  const rows = [];
  const server = http.createServer(async (req, res) => {
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) controller.abort();
    });
    try {
      if (!['/v1/chat/completions', '/v1/models'].includes(req.url)) {
        res.writeHead(404).end();
        return;
      }
      const parts = [];
      let size = 0;
      for await (const part of req) {
        size += part.length;
        if (size > 128 * 1024) throw Error('request_limit');
        parts.push(part);
      }
      const body = Buffer.concat(parts);
      const input = body.length ? JSON.parse(body) : null;
      const response = await fetch(new URL(req.url, origin), {
        method: req.method,
        headers: { 'Content-Type': 'application/json' },
        ...(body.length ? { body } : {}),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(610000)]),
      });
      const partsOut = [];
      let bytes = 0;
      for await (const part of response.body) {
        bytes += part.length;
        if (bytes > 2 * 1024 * 1024) throw Error('response_limit');
        partsOut.push(part);
      }
      const raw = Buffer.concat(partsOut);
      const value = JSON.parse(raw);
      if (input) {
        let task;
        try {
          task = JSON.parse(input.messages.at(-1).content).task;
        } catch {}
        rows.push({
          status: response.status,
          task,
          max_tokens: input.max_tokens,
          prompt_characters: input.messages.reduce((n, m) => n + m.content.length, 0),
          finish_reason: value.choices?.[0]?.finish_reason,
          content: value.choices?.[0]?.message?.content,
          usage: value.usage,
          error: value.error?.message,
        });
        await fs.writeFile(file, JSON.stringify(rows, null, 2));
      }
      res.writeHead(response.status, { 'Content-Type': 'application/json' }).end(raw);
    } catch (e) {
      if (!res.destroyed) res.writeHead(502).end(JSON.stringify({ error: e.message }));
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    base: `http://127.0.0.1:${server.address().port}/v1`,
    close: () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  };
};
