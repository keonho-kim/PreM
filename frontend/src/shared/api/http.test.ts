/// <reference types="node" />
// @vitest-environment node
// Purpose: Verify JSON contracts, cancellation and time bounds through actual Axios I/O.
// Pattern: Ephemeral local HTTP fixture; no app storage or production network access.
// Usage: Vitest runs these transport regressions alongside feature behavior tests.
// Related: http.ts, pages/home-page.test.tsx.
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { isCancel } from 'axios';
import { z } from 'zod';
import { ApiError, request } from './http';

let server: Server;
let base: string;
beforeAll(async () => {
  server = createServer(async (req, res) => {
    if (req.url === '/pending') return; // Client cancellation/timeout must release this socket.
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/conflict') {
      res
        .writeHead(409)
        .end(JSON.stringify({ code: 'version_conflict', message: '새로고침하세요.' }));
    } else if (req.url === '/broken') {
      res.writeHead(502).end('<html>gateway failure</html>');
    } else if (req.url === '/invalid') {
      res.end(JSON.stringify({ ok: 'not a boolean' }));
    } else {
      let body = '';
      for await (const chunk of req) body += chunk;
      res.end(
        JSON.stringify({
          method: req.method,
          body,
          key: req.headers['idempotency-key'],
          accept: req.headers.accept,
          contentType: req.headers['content-type'],
        }),
      );
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture address');
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

it('preserves JSON mutation bodies, version checks and idempotency headers', async () => {
  const body = JSON.stringify({ name: '프로젝트', expected_version: 3 });
  const schema = z.object({
    method: z.literal('PATCH'),
    body: z.literal(body),
    key: z.literal('receipt-1'),
    accept: z.literal('application/json'),
    contentType: z.literal('application/json'),
  });
  await expect(
    request(`${base}/echo`, schema, {
      method: 'PATCH',
      body,
      headers: { 'Idempotency-Key': 'receipt-1' },
    }),
  ).resolves.toMatchObject({ method: 'PATCH', key: 'receipt-1' });
});
it('preserves public conflict details', async () => {
  await expect(request(`${base}/conflict`, z.unknown())).rejects.toMatchObject({
    name: 'ApiError',
    status: 409,
    code: 'version_conflict',
    message: '새로고침하세요.',
  });
});
it('maps non-JSON HTTP failures without leaking proxy bodies', async () => {
  await expect(request(`${base}/broken`, z.unknown())).rejects.toEqual(
    new ApiError(502, 'request_failed', '요청을 처리하지 못했습니다. 다시 시도해 주세요.'),
  );
});
it('rejects successful responses that violate the feature schema', async () => {
  await expect(request(`${base}/invalid`, z.object({ ok: z.boolean() }))).rejects.toBeInstanceOf(
    z.ZodError,
  );
});
it('propagates caller cancellation separately from API failures', async () => {
  const controller = new AbortController();
  const result = request(`${base}/pending`, z.unknown(), { signal: controller.signal }).catch(
    (error: unknown) => error,
  );
  controller.abort();
  expect(isCancel(await result)).toBe(true);
});
it('bounds a non-responsive request', async () => {
  await expect(request(`${base}/pending`, z.unknown(), { timeout: 30 })).rejects.toMatchObject({
    code: 'ECONNABORTED',
  });
});
