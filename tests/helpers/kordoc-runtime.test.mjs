// Purpose: Verify bundled PDF text/OCR extraction without network or development executables.
// Pattern: Real production adapter under Node permissions with Korean PDF fixtures and owned output.
// Usage: runtime/node/bin/node --test tests/helpers/kordoc-runtime.test.mjs.
// Related: backend/tools/document-extract.mjs, scripts/prepare-document-runtime.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, cp } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const run = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));
const runtime = path.join(root, 'runtime');
const fixtures = path.join(root, 'tests/fixtures/parsing-quality');
const artifacts = path.join(root, 'tests/.artifacts');
for (const [name, expected] of [
  ['korean-columns.pdf', ['업무 개선 검토 보고서', '현황 조사', '후속 조치']],
  ['korean-mixed.pdf', ['업무 점검 안내', '월간 운영 점검', '운영지원팀', '120건']],
]) {
  test(`offline bundled PDF pipeline preserves Korean text: ${name}`, {
    timeout: 180000,
  }, async () => {
    await mkdir(artifacts, { recursive: true });
    const work = await mkdtemp(path.join(artifacts, 'kordoc-offline-'));
    try {
      const cache = path.join(work, 'models');
      await cp(path.join(runtime, 'kordoc/models'), cache, { recursive: true });
      await run(
        path.join(runtime, 'node/bin/node'),
        [
          '--permission',
          '--allow-addons',
          '--allow-worker',
          `--allow-fs-read=${runtime}`,
          `--allow-fs-read=${fixtures}`,
          `--allow-fs-read=${work}`,
          `--allow-fs-write=${work}`,
          path.join(runtime, 'document-extract.mjs'),
          path.join(fixtures, name),
          work,
        ],
        {
          cwd: work,
          timeout: 150000,
          env: {
            ...process.env,
            PATH: '/nonexistent',
            KORDOC_OFFLINE: '1',
            KORDOC_MODEL_CACHE: cache,
            TMPDIR: work,
          },
        },
      );
      const result = JSON.parse(await readFile(path.join(work, 'result.json'), 'utf8'));
      const text = result.pages
        .flatMap((page) => page.blocks.map((block) => block.text))
        .join('\n');
      for (const value of expected)
        assert.ok(text.includes(value), `Missing source text: ${value}`);
      assert.ok(result.pages.length >= (name === 'korean-mixed.pdf' ? 2 : 1));
      assert.ok(
        result.pages.every((page) => page.preview),
        'Every PDF page needs a preview',
      );
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });
}
