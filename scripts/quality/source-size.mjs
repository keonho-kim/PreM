#!/usr/bin/env node
// Purpose: Enforce the repository's authored-source file size limit before code grows unreviewable.
// Pattern: Git-owned file inventory and actionable source-size failures.
// Usage: pnpm check:structure; ignored runtime/data/build output is never scanned.
// Related: AGENTS.md section 6, frontend/dependency-cruiser.cjs, check.sh.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const files = new Set(
  execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean),
);
const extensions = new Set([
  '.rs',
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.py',
  '.sh',
  '.css',
  '.html',
]);
let checked = 0;
const oversized = [];
for (const name of files) {
  const file = path.join(root, name);
  if (!extensions.has(path.extname(name)) || !existsSync(file)) continue;
  checked++;
  const text = readFileSync(file, 'utf8');
  const count = text ? text.split('\n').length - Number(text.endsWith('\n')) : 0;
  if (count > 350) oversized.push(`${name}: ${count} lines (limit 350)`);
}
if (oversized.length) {
  console.error(oversized.join('\n'));
  process.exitCode = 1;
} else console.log(`PASS: ${checked} authored source files within 350 lines.`);
