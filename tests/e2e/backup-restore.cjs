// Purpose: Verify real application lock exclusion and recovery of shared data and encrypted settings.
// Pattern: Two isolated server roots, local model fixture and offline maintenance CLI.
// Usage: pnpm test:e2e backup-restore; never reads the development data directory.
// Related: scripts/storage-backup.py, configure-documents.cjs, server.cjs.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createServer } = require('./server.cjs');
const { configureDocuments } = require('./configure-documents.cjs');
const { json } = require('./outline-fixture.cjs');
const { upload, ready } = require('./related-fixture.cjs');
const { authorizedFetch: fetch } = require('./admin-client.cjs');
const { projectRoot } = require('../helpers/browser.cjs');
const run = promisify(execFile);
(async () => {
  const original = await createServer('backup-original-'),
    restored = await createServer('backup-restored-');
  const archive = path.join(
    projectRoot,
    'tests/.artifacts',
    `backup-${crypto.randomUUID()}.tar.gz`,
  );
  let fixture;
  const maintenance = (...args) =>
    run('python3', ['scripts/storage-backup.py', ...args], {
      cwd: projectRoot,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    });
  try {
    await original.start();
    fixture = await configureDocuments(original.base);
    const providers = await json(original.base, '/api/v1/admin/llm/providers');
    await json(original.base, `/api/v1/admin/llm/providers/${providers[0].id}`, 'PUT', {
      expected_version: 1,
      name: '복원 검증',
      provider_type: 'openai_compatible',
      base_url: fixture.base,
      model_identifier: 'fixture',
      timeout_seconds: 30,
      enabled: true,
      api_key: 'synthetic-backup-credential',
    });
    const project = await json(original.base, '/api/v1/projects', 'POST', {
      name: '백업한 프로젝트',
      due_date: '2030-01-01',
    });
    const bytes = '# 원본 문서\n\n복원 후에도 보존되는 내용입니다.';
    const item = await upload(original.base, project.id, 'source.md', bytes);
    await ready(original.base, project.id, item);
    await assert.rejects(
      maintenance('backup', '--data-storage-path', original.storage, '--output', archive),
      /Stop PreM/,
    );
    await original.stop();
    await maintenance('backup', '--data-storage-path', original.storage, '--output', archive);
    await fs.rmdir(restored.storage);
    await maintenance('restore', '--archive', archive, '--data-storage-path', restored.storage);
    await restored.start();
    assert.equal((await json(restored.base, `/api/v1/projects/${project.id}`)).name, project.name);
    const saved = await json(restored.base, '/api/v1/admin/llm/providers');
    assert.equal(saved[0].has_secret, true);
    const response = await fetch(
      `${restored.base}/api/v1/projects/${project.id}/files/${item.id}/download`,
    );
    assert.equal(await response.text(), bytes);
    await assert.rejects(
      maintenance('restore', '--archive', archive, '--data-storage-path', restored.storage),
      /new storage path/,
    );
    console.log(
      'PASS: running storage rejected; project, original bytes and encrypted provider settings survive offline restore.',
    );
  } finally {
    await original.close();
    await restored.close();
    if (fixture) await fixture.close();
    await fs.rm(archive, { force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
