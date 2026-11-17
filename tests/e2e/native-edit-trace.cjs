// Purpose: Capture only visible native LM Studio answers for synthetic editor acceptance QA.
// Pattern: Loopback protocol-preserving relay; reasoning items and request credentials are not saved.
// Usage: Opt-in PREM_TRACE_EDIT=1 with synthetic presentation-objects.cjs data only.
// Related: native LM Studio /api/v1/chat, tests/.artifacts/native-edit-visible.json.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { once } = require('node:events');
module.exports = async function trace(root) {
  const results = [];
  const server = http.createServer(async (req, res) => {
    try {
      if (req.url !== '/api/v1/chat' || req.method !== 'POST') {
        res.writeHead(404).end();
        return;
      }
      const parts = [];
      let size = 0;
      for await (const part of req) {
        size += part.length;
        if (size > 100000) throw Error('limit');
        parts.push(part);
      }
      const reply = await fetch('http://127.0.0.1:1234/api/v1/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: Buffer.concat(parts),
        signal: AbortSignal.timeout(180000),
      });
      const body = await reply.text();
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {}
      results.push({
        status: reply.status,
        output: parsed?.output?.filter((p) => p.type === 'message'),
        stats: parsed?.stats,
      });
      await fs.writeFile(
        path.join(root, 'tests/.artifacts/native-edit-visible.json'),
        JSON.stringify(results, null, 2),
      );
      res.writeHead(reply.status, { 'Content-Type': 'application/json' }).end(body);
    } catch {
      res.writeHead(502).end('{}');
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    base: `http://127.0.0.1:${server.address().port}/api/v1`,
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
};
