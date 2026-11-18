// Purpose: Supply explicit per-instance Admin credentials to isolated browser-test API setup.
// Pattern: Tokens stay in process memory, are redacted from logs and rotate with the real server.
// Usage: Feature fixtures import authorizedFetch; access-control tests use unmodified global fetch.
// Related: server.cjs, admin-access.cjs.
const tokens = new Map();
function setToken(base, token) {
  tokens.set(base, token);
}
function forgetToken(base) {
  tokens.delete(base);
}
async function authorizedFetch(input, init) {
  const url = new URL(typeof input === 'string' ? input : (input.url ?? String(input)));
  if (url.pathname.startsWith('/api/v1/admin/')) {
    const token = tokens.get(url.origin);
    if (!token) throw Error('Test Admin token is not available');
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
    if (
      init?.method === 'PUT' &&
      /^\/api\/v1\/admin\/llm\/providers\/[^/]+$/.test(url.pathname) &&
      !headers.has('X-Connection-Diagnostic')
    ) {
      const probe = await fetch(new URL(url.pathname + '/diagnose', url), {
        ...init,
        method: 'POST',
        headers,
      });
      if (!probe.ok) return probe;
      const { ticket } = await probe.json();
      if (!ticket) throw Error('No supported configuration found in the diagnostic');
      headers.set('X-Connection-Diagnostic', ticket);
    }
    return fetch(input, { ...init, headers });
  }
  return fetch(input, init);
}
module.exports = { setToken, forgetToken, authorizedFetch };
