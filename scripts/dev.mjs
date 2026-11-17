// Purpose: Start local product servers with repository-scoped application storage.
// Pattern: Owned child processes with shared termination and bounded shutdown.
// Usage: pnpm dev [instance] or pnpm dev:backend.
// Related: package.json, backend/src/main.rs, frontend/vite.config.ts.
import { spawn } from 'node:child_process';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { 'backend-only': { type: 'boolean', default: false } },
});
const dataRoot = resolve(root, 'data');
const dataPath = resolve(dataRoot, positionals[0] ?? '.');
const relativePath = relative(dataRoot, dataPath);
if (
  positionals.length > 1 ||
  relativePath === '..' ||
  relativePath.startsWith('../') ||
  isAbsolute(relativePath)
) {
  console.error('개발 데이터는 현재 프로젝트의 ./data/ 하위에 저장해야 합니다.');
  process.exit(1);
}
try {
  await mkdir(dataPath, { recursive: true });
} catch (error) {
  console.error(`개발 데이터 디렉터리를 만들 수 없습니다: ${dataPath}`);
  console.error(`프로젝트 ./data/ 폴더의 쓰기 권한을 확인해 주세요. ${error.message}`);
  process.exit(1);
}
const children = new Set();
let stopping = false;

function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch (error) {
      if (error.code !== 'ESRCH') console.error(error.message);
    }
  }
  const timer = setTimeout(() => {
    for (const child of children) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* Process has exited. */
      }
    }
  }, 5_000);
  timer.unref();
}

function start(command, args, env = {}) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: 'inherit',
    detached: true,
    env: { ...process.env, ...env },
  });
  children.add(child);
  child.once('error', (error) => {
    children.delete(child);
    console.error(`${command}: ${error.message}`);
    stop(1);
  });
  child.once('exit', (code) => {
    children.delete(child);
    if (!stopping) stop(code ?? 1);
  });
}

process.once('SIGINT', () => stop(130));
process.once('SIGTERM', () => stop(0));

if (!values['backend-only']) console.log('PreM: http://127.0.0.1:5173/home');
console.log(`Development storage: ${dataPath}`);
start(
  'cargo',
  ['run', '--locked', '-p', 'prem-backend', '--bin', 'PreM', '--', '--data-storage-path', dataPath],
  {
    APP_LISTEN_ADDRESS: '127.0.0.1',
    APP_PORT: '8000',
  },
);
if (!values['backend-only']) start('pnpm', ['--dir', 'frontend', 'dev']);
