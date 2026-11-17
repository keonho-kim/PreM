// Purpose: Audit real parsing quality against the public/synthetic corpus with deterministic local classification.
// Pattern: Disposable real server, sequential uploads, canonical API projections and explicit findings.
// Usage: pnpm audit:parsing after pnpm build; exits 1 for quality findings and 2 for harness failure.
// Related: parsing-checks.mjs, parsing-fixtures.py, tests/e2e/server.cjs.
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { checkExtraction } from './parsing-checks.mjs';
const require = createRequire(import.meta.url);
const { createServer } = require('../e2e/server.cjs');
const { configureDocuments } = require('../e2e/configure-documents.cjs');
const { authorizedFetch: fetch } = require('../e2e/admin-client.cjs');
const root = fileURLToPath(new URL('../../', import.meta.url));
const corpus = resolve(root, 'tests/fixtures/parsing-quality');
const output = resolve(root, 'tests/.artifacts/parsing-quality');
const cancel = new AbortController();
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function json(base, path, options) {
  const response = await fetch(base + path, {
    ...options,
    signal: AbortSignal.any([cancel.signal, AbortSignal.timeout(30000)]),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(value)}`);
  return value;
}
async function ready(base, id) {
  const deadline = Date.now() + 210000;
  while (Date.now() < deadline) {
    const detail = await json(base, `/api/v1/space/references/${id}/processing`);
    if (['succeeded', 'failed', 'cancelled'].includes(detail.job.status)) return detail;
    await delay(150, undefined, { signal: cancel.signal });
  }
  throw new Error('Extraction exceeded audit wait limit');
}
async function run() {
  await mkdir(output, { recursive: true });
  const expectations = JSON.parse(await readFile(resolve(corpus, 'expectations.json'), 'utf8'));
  const sources = JSON.parse(await readFile(resolve(corpus, 'sources.json'), 'utf8'));
  const generated = JSON.parse(await readFile(resolve(corpus, 'generated.json'), 'utf8'));
  const hashes = new Map(
    [...sources.assets, ...generated.assets].map((asset) => [asset.file, asset.sha256]),
  );
  const server = await createServer('parsing-quality-');
  const report = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    classification: 'local synthetic fixture; not live-model acceptance',
    cases: [],
  };
  const runtime = JSON.parse(
    await readFile(resolve(root, 'runtime/document-manifest.json'), 'utf8'),
  );
  report.runtime = {
    platform: runtime.platform,
    arch: runtime.arch,
    kordoc: runtime.kordoc,
    ppt_master: runtime.ppt_master,
    manifest_sha256: sha(await readFile(resolve(root, 'runtime/document-manifest.json'))),
  };
  const stop = () => cancel.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  let fixture;
  try {
    await server.start();
    fixture = await configureDocuments(server.base);
    for (const entry of expectations.cases) {
      cancel.signal.throwIfAborted();
      const bytes = await readFile(resolve(corpus, entry.file));
      if (!hashes.has(entry.file) || sha(bytes) !== hashes.get(entry.file))
        throw new Error(`Fixture hash mismatch: ${entry.file}`);
      const start = performance.now();
      const form = new FormData();
      form.set('file', new Blob([bytes]), basename(entry.file));
      form.set('title', entry.id);
      form.set('tags', '[]');
      const item = await json(server.base, '/api/v1/space/references', {
        method: 'POST',
        headers: { 'Idempotency-Key': randomUUID() },
        body: form,
      });
      const detail = await ready(server.base, item.id);
      const blocks = [];
      if (detail.job.extraction_id) {
        for (let offset = 0; offset < 20000; offset += 50) {
          const page = await json(
            server.base,
            `/api/v1/document-jobs/${detail.job.id}/blocks?offset=${offset}`,
          );
          blocks.push(...page);
          if (page.length < 50) break;
        }
      }
      let materials = [];
      if (detail.reuse_ready) {
        const result = await json(server.base, `/api/v1/document-jobs/${detail.job.id}/materials`);
        materials = result.items;
        if (result.total > materials.length)
          throw new Error('Corpus material list needs pagination');
      }
      const checks = entry.checks.map((check) => checkExtraction(check, detail, blocks, materials));
      const extracted = !!detail.job.extraction_id && detail.job.status === 'succeeded';
      const result = {
        id: entry.id,
        file: entry.file,
        sha256: sha(bytes),
        status: detail.job.status,
        error: detail.job.error_code,
        profile: detail.job.profile,
        warnings: detail.warnings,
        elapsed_ms: Math.round(performance.now() - start),
        pages: detail.pages.length,
        blocks: blocks.length,
        checks,
        pass: extracted && checks.every((check) => check.pass),
      };
      report.cases.push(result);
      await writeFile(
        resolve(output, `${entry.id}.json`),
        JSON.stringify({ detail, blocks, materials }, null, 2),
      );
      console.log(
        `${result.pass ? 'PASS' : 'FINDING'} ${entry.id}: ${checks.filter((c) => c.pass).length}/${checks.length}, ${result.status}`,
      );
    }
    const providers = await json(server.base, '/api/v1/admin/llm/providers');
    if (providers.length !== 1 || fixture.calls() !== 0)
      throw new Error('Audit must use only its classification fixture');
    report.summary = {
      documents: report.cases.length,
      passed: report.cases.filter((c) => c.pass).length,
      checks: report.cases.flatMap((c) => c.checks).length,
      findings: report.cases.flatMap((c) => c.checks).filter((c) => !c.pass).length,
    };
    await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    const rows = report.cases.flatMap((c) =>
      c.checks
        .filter((check) => !check.pass)
        .map(
          (check) =>
            `| ${c.id} | ${check.type} | ${JSON.stringify(check.observed).replaceAll('|', '\\|')} |`,
        ),
    );
    await writeFile(
      resolve(output, 'report.md'),
      `# Parsing quality audit\n\n${report.summary.passed}/${report.summary.documents} documents meet all authored checks. ${report.summary.findings}/${report.summary.checks} checks need attention. Classification used a local deterministic fixture.\n\n| Document | Check | Observation |\n| --- | --- | --- |\n${rows.join('\n')}\n\nSee report.json and per-document projections for source hashes, runtime identity and detailed evidence.\n`,
    );
    process.exitCode = report.cases.every((c) => c.pass) ? 0 : 1;
  } finally {
    await server.close();
    if (fixture) await fixture.close();
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}
run().catch((error) => {
  console.error(error.message);
  process.exitCode = 2;
});
