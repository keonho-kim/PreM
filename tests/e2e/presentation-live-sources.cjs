// Purpose: Check public PDF reference retrieval without duplicating canonical extraction or invoking search models.
// Pattern: Same original in project/Space, content/file searches and an absent-query control.
// Usage: Opt-in presentation-live.cjs; returns only read-only acceptance evidence.
// Related: search/api.ts, document-processing/, shared PPT storage contracts.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { authorizedFetch: fetch } = require('./admin-client.cjs');
const { json } = require('./outline-fixture.cjs');
const { setTimeout: delay } = require('node:timers/promises');
module.exports = async function sourceChecks(base, pdf, originalExtraction) {
  const form = new FormData();
  form.set('file', new Blob([pdf]), 'w3c-accessibility.pdf');
  form.set('title', 'W3C 접근성 공개 원본');
  form.set('tags', '[]');
  const response = await fetch(base + '/api/v1/space/references', {
    method: 'POST',
    headers: { 'Idempotency-Key': randomUUID() },
    body: form,
  });
  const asset = await response.json();
  assert.equal(response.status, 201, JSON.stringify(asset));
  let detail;
  for (let i = 0; i < 300; i++) {
    detail = await json(base, `/api/v1/space/references/${asset.id}/processing`);
    assert.notEqual(detail.job.status, 'failed', JSON.stringify(detail.job));
    if (detail.job.extraction_id) break;
    await delay(100);
  }
  assert.equal(
    detail.job.extraction_id,
    originalExtraction,
    'Project/Space share canonical extraction',
  );
  const find = (q, mode) =>
    json(
      base,
      `/api/v1/search?${new URLSearchParams({ q, mode, scope: 'references', archived: 'false', offset: '0' })}`,
    );
  const content = await find('accessibility', 'content'),
    files = await find('W3C', 'files');
  assert(content.items.some((i) => i.content_match && i.job_id === detail.job.id));
  assert(files.items.some((i) => i.name_match && i.filename === 'w3c-accessibility.pdf'));
  assert.equal((await find('unmatched' + randomUUID().replaceAll('-', ''), 'all')).total, 0);
  return {
    extraction_id: detail.job.extraction_id,
    content_matches: content.total,
    file_matches: files.total,
    content,
    files,
  };
};
