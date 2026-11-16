// Purpose: Own an isolated compiled application and disposable storage for browser journeys.
// Pattern: Explicit start, restart and cleanup; never use development application data.
// Usage: createServer(prefix) after pnpm build; call close in finally.
// Related: projects.cjs, space.cjs, ../../.artifacts/.
const assert = require('node:assert/strict');
const { setToken, forgetToken } = require('./admin-client.cjs');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { projectRoot } = require('../../mock/helpers/browser.cjs');
async function createServer(prefix) {
  const root = path.join(projectRoot, 'tests/.artifacts');
  fs.mkdirSync(root, { recursive: true });
  const storage = fs.mkdtempSync(path.join(root, prefix));
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  let child;
  let adminToken;
  async function stop() {
    forgetToken(base);
    adminToken = undefined;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    try {
      await exited;
    } finally {
      clearTimeout(timer);
    }
  }
  async function start() {
    child = spawn(
      path.join(projectRoot, 'target/release/PuPuTyX'),
      ['--data-storage-path', storage, '--listen-address', '127.0.0.1', '--port', String(port)],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let log = '';
    for (const out of [child.stdout, child.stderr]) {
      let pending = '';
      out.on('data', (s) => {
        pending += s;
        let end;
        while ((end = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, end);
          pending = pending.slice(end + 1);
          const match = line.match(/^PuPuTyX Admin token: ([a-f0-9]{64})$/);
          if (match) {
            adminToken = match[1];
            setToken(base, adminToken);
          } else log = (log + line + '\n').slice(-8000);
        }
      });
    }
    for (let attempt = 0; attempt < 80; attempt++) {
      assert.equal(child.exitCode, null, log);
      try {
        if ((await fetch(base + '/healthz')).ok && adminToken) return;
      } catch {}
      await delay(100);
    }
    throw new Error('Server did not start: ' + log);
  }
  return {
    base,
    storage,
    async unlock(page) {
      if (await page.$('.admin-layout')) return;
      const field = await page.waitForSelector('#admin-token', { visible: true });
      await field.type(adminToken);
      await page.click('.admin-access-form button[type=submit]');
      await page.waitForSelector('.admin-layout', { visible: true });
    },
    start,
    stop,
    async close() {
      await stop();
      fs.rmSync(storage, { recursive: true, force: true });
    },
  };
}
module.exports = { createServer };
