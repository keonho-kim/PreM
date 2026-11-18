// Purpose: Check real PDF upload, chapter dividers, corrected numbering and persisted page labels.
// Pattern: Print a synthetic no-footer PDF and answer Decision choices with a deterministic fixture.
// Usage: pnpm test:e2e page-alignment after pnpm build; storage and model are isolated.
// Related: modules/documents/alignment/, document-processing/content.tsx, server.cjs.
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const http = require('node:http');
const { openBrowser } = require('../helpers/browser.cjs');
const { clickRole } = require('../helpers/interactions.cjs');
const { createServer } = require('./server.cjs');
const { json } = require('./outline-fixture.cjs');
const lines = [
  ['Operations manual'],
  ['Alpha ... 1', 'Beta ... 4', 'Gamma ... 6'],
  ['Getting started'],
  ['Project goals'],
  ['Required materials'],
  ['Part Two'],
  ['Implementation plan'],
  ['Milestones'],
  ['Evaluating outcomes'],
];
function decide(state, key, question) {
  if (state.regions) return /^(Alpha|Beta|Gamma)/.test(state.regions[key].text) ? '1' : '0';
  if (state.lines) return '1';
  const text = state.current.map((b) => b.text).join(' ');
  const position = lines.findIndex((row) =>
    row.some((line) => text.replace(/\s/g, '').includes(line.replace(/\s/g, ''))),
  );
  if (key === 'section') {
    const title =
      position < 2 ? undefined : position <= 4 ? 'Alpha' : position <= 7 ? 'Beta' : 'Gamma';
    return (
      Object.entries(question.criteria).find(([, v]) => title && v.startsWith(title))?.[0] ?? '0'
    );
  }
  if (key === 'role') return position === 5 ? '3' : [2, 6, 8].includes(position) ? '1' : '2';
  assert.equal(key, 'evidence');
  return '1';
}
(async () => {
  const server = await createServer('chapter-alignment-');
  let session,
    calls = 0;
  const fixture = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    assert.equal(req.url, '/v1/systemone');
    const ctx = JSON.parse(raw);
    const answers = Object.fromEntries(
      Object.entries(ctx.questions).map(([key, question]) => {
        const choice = decide(ctx.state, key, question);
        const probabilities = Object.fromEntries(
          Object.keys(question.criteria).map((k) => [k, k === choice ? 1 : 0]),
        );
        return [key, { type: 'choice', choice, probabilities, confidence: 1 }];
      }),
    );
    calls++;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ model: 'alignment', answers }));
  });
  try {
    fixture.listen(0, '127.0.0.1');
    await once(fixture, 'listening');
    await server.start();
    const id = randomUUID();
    await json(server.base, '/api/v1/admin/llm/providers/' + id, 'PUT', {
      expected_version: 0,
      name: 'Page alignment fixture',
      provider_type: 'lm_studio_decision',
      base_url: `http://127.0.0.1:${fixture.address().port}/v1`,
      model_identifier: 'alignment',
      timeout_seconds: 30,
      enabled: true,
    });
    await json(server.base, '/api/v1/admin/document-processing/settings', 'PUT', {
      expected_version: 0,
      connection_id: id,
    });
    session = await openBrowser('page-alignment');
    const page = await session.browser.newPage();
    await page.setContent(
      '<style>section{break-after:page}section:last-child{break-after:auto}</style>' +
        lines
          .map(
            (row) => '<section>' + row.map((line) => '<p>' + line + '</p>').join('') + '</section>',
          )
          .join(''),
    );
    const pdf = await page.pdf({ format: 'A4', displayHeaderFooter: false });
    const form = new FormData();
    form.set('file', new Blob([pdf]), 'no-footer.pdf');
    form.set('title', '간지 보정 문서');
    form.set('tags', '[]');
    const upload = await fetch(server.base + '/api/v1/space/references', {
      method: 'POST',
      headers: { 'Idempotency-Key': randomUUID() },
      body: form,
    });
    assert.equal(upload.status, 201);
    const item = await upload.json();
    const route = server.base + '/api/v1/space/references/' + item.id + '/processing';
    await page.goto(server.base + '/home/space/library');
    await page.locator('.space-title-button').click();
    await page.waitForFunction(() => document.body.textContent.includes('자료 준비 완료'), {
      timeout: 90000,
    });
    await clickRole(page, '원본 페이지', 'tab');
    const d = await (await fetch(route)).json();
    assert.deepEqual(
      d.pages.map((p) => p.alignment.printed_page),
      [null, null, 1, 2, 3, null, 4, 5, 6],
    );
    assert.equal(d.pages[5].alignment.role, 'divider');
    assert.equal(d.pages[5].alignment.section, 'Beta');
    assert.match(
      await page.$eval('.processing-pages article:nth-child(7)', (n) => n.textContent),
      /Beta.*장 시작.*추정 4쪽/s,
    );
    const prior = calls;
    await server.stop();
    await server.start();
    assert.deepEqual((await (await fetch(route)).json()).pages, d.pages);
    assert.equal(calls, prior);
    await require('./source-outline-check.cjs')(page, server.base);
    console.log(
      'PASS: original physical positions, no-footer chapter assignment, divider correction and restart.',
    );
  } finally {
    if (session) await session.close();
    await server.close();
    fixture.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
