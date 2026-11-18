// Purpose: Check original contents hierarchy, page boundaries, and exclusion of a later sample outline.
// Pattern: Synthetic PDF through real upload, durable processing and keyboard-operated outline disclosure.
// Usage: Invoked by page-alignment.cjs with its own fixture and app storage.
// Related: source-outline.tsx, documents/alignment/catalog.rs.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { clickRole } = require('../helpers/interactions.cjs');
module.exports = async function check(page, base) {
  const pages = [
    [
      'Contents',
      'I. Scope',
      '1. Background ... 1',
      '2. Goals ... 2',
      'II. Schedule',
      '1. Milestones ... 3',
    ],
    ['I. Scope', 'Project background and goals'],
    ['Goals continued'],
    ['II. Schedule', 'Milestone definitions'],
    ['Suggested response outline', 'I. Qualifications', 'II. Budget'],
  ];
  await page.goto('about:blank');
  await page.setContent(
    '<style>section{break-after:page}section:last-child{break-after:auto}</style>' +
      pages
        .map((lines) => '<section>' + lines.map((t) => '<p>' + t + '</p>').join('') + '</section>')
        .join(''),
  );
  const pdf = await page.pdf({ format: 'A4', displayHeaderFooter: false });
  const form = new FormData();
  form.set('file', new Blob([pdf]), 'hierarchy.pdf');
  form.set('title', '계층 확인');
  form.set('tags', '[]');
  const res = await fetch(base + '/api/v1/space/references', {
    method: 'POST',
    headers: { 'Idempotency-Key': randomUUID() },
    body: form,
  });
  assert.equal(res.status, 201);
  const item = await res.json();
  await page.goto(base + '/home/space/library');
  await clickRole(page, '계층 확인 미리보기');
  await page.waitForFunction(() => document.body.innerText.includes('자료 준비 완료'), {
    timeout: 90000,
  });
  await clickRole(page, '원본 페이지', 'tab');
  const trigger = page.locator('button::-p-text(원문 목차 · 대목차 2개)');
  await trigger.click();
  const result = await (
    await fetch(base + '/api/v1/space/references/' + item.id + '/processing')
  ).json();
  assert.deepEqual(
    result.source_outline.map((e) => e.children?.length ?? 0),
    [2, 1],
  );
  assert.match(result.source_outline[0].title, /Scope/);
  assert.match(result.source_outline[1].title, /Schedule/);
  assert.equal(result.pages[2].alignment.section, result.source_outline[0].title);
  assert.equal(result.pages[4].alignment.section, result.source_outline[1].title);
  const list = await page.$eval('ol[aria-label="원문 목차"]', (n) => n.textContent);
  assert.match(list, /Milestones/);
  assert(!list.includes('Qualifications'));
};
