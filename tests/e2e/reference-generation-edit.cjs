// Purpose: Verify explicit API reference generation, editor insertion and reviewed object chat edits.
// Pattern: Actual compiled server/UI, source extraction and PPTX rendering with a local model fixture.
// Usage: After pnpm build; captures are Folio and all uploaded inputs are synthetic QA fixtures.
// Related: presentation_references.rs, outline-fixture.cjs, material-insertion.tsx.
const { setViewport } = require('../helpers/interactions.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { createServer } = require('./server.cjs');
const { model, json } = require('./outline-fixture.cjs');
const { upload, ready } = require('./related-fixture.cjs');
const { openBrowser, projectRoot } = require('../helpers/browser.cjs');
async function poll(read, done) {
  const end = Date.now() + 120000;
  while (Date.now() < end) {
    const value = await read();
    if (done(value)) return value;
    await delay(150);
  }
  throw Error('Reference journey timed out');
}
async function click(page, name, role = 'button') {
  const item = await page.waitForSelector(`::-p-aria(${name}[role="${role}"])`, { visible: true });
  await item.evaluate((n) => n.scrollIntoView({ block: 'center' }));
  await item.click();
}
async function capture(page, name) {
  await page.screenshot({ path: path.join(projectRoot, 'tests/.artifacts/captures/folio', name) });
}
(async () => {
  const server = await createServer('reference-generation-'),
    fixture = await model();
  let browser;
  try {
    await server.start();
    const base = server.base;
    const project = await json(base, '/api/v1/projects', 'POST', {
        name: '레퍼런스 활용 발표',
        due_date: '2030-01-01',
      }),
      p = project.id,
      root = `/api/v1/projects/${p}`;
    const author = randomUUID();
    await json(base, `/api/v1/admin/llm/providers/${author}`, 'PUT', {
      expected_version: 0,
      name: '발표 작성 AI',
      provider_type: 'openai_compatible',
      base_url: fixture.base,
      model_identifier: 'outline-fixture',
      timeout_seconds: 60,
      enabled: true,
    });
    await json(base, '/api/v1/admin/document-processing/settings', 'PUT', {
      expected_version: 0,
      connection_id: author,
    });
    const source = await upload(
      base,
      p,
      'source.md',
      '# 업무 현황\n\n현재 진행 상황을 정리합니다.\n\n실행 계획과 일정에 맞춰 업무를 준비합니다.',
    );
    await ready(base, p, source);
    const review = await json(base, root + '/source-review');
    await json(base, root + '/source-review', 'PUT', { snapshot: review.snapshot });
    await json(base, root + '/guide', 'PUT', {
      expected_version: 0,
      do_text: '원문을 바탕으로 간결하게 작성',
      dont_text: '수치를 만들지 않음',
    });
    const empty = await json(base, root + '/outline');
    await json(base, root + '/outline/runs', 'POST', {
      expected_version: 0,
      source_snapshot: empty.source_snapshot,
      guide_version: 1,
      connection_id: author,
      model_version: 1,
      kind: 'generate',
      node_ids: [],
    });
    const outline = await poll(
      () => json(base, root + '/outline'),
      (s) => s.run?.status === 'succeeded',
    );
    await json(base, root + '/outline/confirm', 'POST', { expected_version: outline.version });
    const prep = await json(base, root + '/presentation-preparation'),
      evidence = await json(base, root + '/presentation-preparation/evidence', 'POST', {
        fingerprint: prep.fingerprint,
      });
    await json(base, root + '/presentation-preparation/design', 'PUT', {
      expected_version: evidence.version,
      evidence_review_id: evidence.evidence_review_id,
      template_job_id: null,
    });
    const form = new FormData();
    form.set('title', '공용 차트 자료');
    form.set('tags', '[]');
    form.set(
      'file',
      new Blob([
        await fs.readFile(
          path.join(projectRoot, 'tests/fixtures/documents/reference-materials.pptx'),
        ),
      ]),
      'references.pptx',
    );
    const response = await fetch(base + '/api/v1/space/references', {
      method: 'POST',
      headers: { 'Idempotency-Key': randomUUID() },
      body: form,
    });
    assert.equal(response.status, 201);
    const asset = await response.json();
    const detail = await poll(
      () => json(base, `/api/v1/space/references/${asset.id}/processing`),
      (d) => {
        assert.notEqual(d.job.status, 'failed', JSON.stringify(d));
        return !!d.job.extraction_id;
      },
    );
    const job = detail.job.id;
    const catalog = await json(base, `/api/v1/document-jobs/${job}/materials?kind=all`);
    const choices = ['slide', 'chart', 'image'].map((kind) =>
      catalog.items.find((m) => m.kind === kind),
    );
    assert(choices.every(Boolean));
    browser = await openBrowser('reference-generation-edit');
    const a = await (await browser.browser.createBrowserContext()).newPage();
    const b = await (await browser.browser.createBrowserContext()).newPage();
    const errors = [];
    a.on('pageerror', (e) => errors.push(e.message));
    await setViewport(a, { width: 1440, height: 1000 });
    const route = base + `/home/studio/${p}?step=generation`;
    await a.goto(route, { waitUntil: 'networkidle0' });
    await a.waitForSelector('#presentation-title', { visible: true });
    async function choose(items) {
      await click(a, '레퍼런스 넣기');
      await click(a, '레퍼런스 파일', 'combobox');
      await click(a, '공용 차트 자료 · references.pptx', 'option');
      await a.waitForSelector('.material-picker-grid li');
      for (const item of items) {
        await a.click(`li[data-material-id="${item.id}"] button[aria-pressed]`);
      }
      await capture(a, 'reference-selection-dialog.png');
      await click(a, `선택한 자료 ${items.length}개 넣기`);
      await a.waitForSelector('.material-insertion', { hidden: true });
    }
    assert.equal(await a.$('.presentation-form .material-insertion'), null);
    assert.equal(await a.$('::-p-aria(레퍼런스 넣기[role="button"])'), null);
    assert.equal(await a.$('#presentation-model'), null);
    // Explicit legacy API insertion remains supported; it is not a public generation control.
    const prepared = await json(base, root + '/presentation-preparation');
    await json(base, root + '/presentations', 'POST', {
      design_id: prepared.design_id,
      title: '레퍼런스 활용 발표',
      instructions: '',
      materials: choices.map((item) => ({ job_id: job, material_id: item.id })),
      presentation_id: null,
      expected_version: 0,
    });
    const read = () => json(base, root + '/presentations');
    const initial = (
      await poll(read, (rows) => {
        assert.notEqual(rows[0]?.status, 'failed', JSON.stringify(rows));
        return rows[0]?.status === 'succeeded';
      })
    )[0];
    assert.equal(initial.total, 3);
    assert.equal(initial.quality.length, 3);
    assert(initial.quality.every((q) => q.report.passed));
    await a.waitForSelector('.presentation-output', { visible: true });
    await a.waitForFunction(
      () => document.querySelectorAll('.presentation-thumbnails button').length > 0,
    );
    await a.$eval('.presentation-deck', (n) => n.scrollIntoView({ block: 'start' }));
    await capture(a, 'reference-generated-native.png');
    await a.$eval('.presentation-quality', (n) => n.scrollIntoView({ block: 'center' }));
    await capture(a, 'presentation-quality-desktop.png');
    await click(a, '참고 자료', 'tab');
    const sourceRows = await json(
      base,
      root +
        `/presentations/${initial.id}/slides/${(await json(base, root + `/presentations/${initial.id}/slides`))[0].id}/materials`,
    );
    assert.equal(sourceRows.length, 2, JSON.stringify(sourceRows));
    await click(a, '사용한 원본 보기');
    await a.waitForSelector('.processing-dialog', { visible: true });
    await capture(a, 'reference-source-version.png');
    await a.keyboard.press('Escape');
    await a.waitForSelector('.processing-dialog', { hidden: true });
    await choose([choices[0]]);
    const inserted = (
      await poll(read, (rows) => {
        if (rows[0]?.id !== initial.id)
          assert.notEqual(rows[0]?.status, 'failed', JSON.stringify(rows[0]));
        return rows[0]?.id !== initial.id && rows[0]?.status === 'succeeded';
      })
    )[0];
    assert.equal(inserted.total, 4);
    assert.equal(inserted.quality.length, 4);
    assert.equal(inserted.quality[0].reused, true);
    assert.equal(inserted.presentation_version, 2);
    const slides = await json(base, root + `/presentations/${inserted.id}/slides`);
    await a.waitForSelector('.presentation-output', { visible: true });
    await click(a, '객체', 'tab');
    const object = slides[0].spec.objects.find((o) => o.content.kind === 'reference');
    assert(object);
    await click(a, `${object.name} 선택`);
    await click(a, 'AI와 대화', 'tab');
    await a.type(
      '#slide-edit-prompt',
      '선택한 차트 객체의 위치를 오른쪽에서 조금 왼쪽으로 옮겨주세요.',
    );
    await click(a, '수정 요청 보내기');
    const thread = root + `/presentations/${inserted.id}/slides/${slides[0].id}/edits`;
    const proposal = (
      await poll(
        () => json(base, thread),
        (rows) => {
          assert.notEqual(rows.at(-1)?.status, 'failed', JSON.stringify(rows));
          return rows.at(-1)?.status === 'ready';
        },
      )
    ).at(-1);
    assert(proposal.steps.every((s) => s.state === 'succeeded'));
    assert.equal(proposal.quality.length, 4);
    assert.equal(proposal.quality[0].reused, false);
    assert(proposal.quality.slice(1).every((q) => q.reused && q.report.passed));
    assert.equal((await read())[0].presentation_version, 2);
    await a.waitForFunction(() =>
      document.querySelector('.slide-edit-proposal')?.textContent.includes('수정안 적용'),
    );
    await a.$eval('.presentation-deck', (n) => n.scrollIntoView({ block: 'start' }));
    await capture(a, 'reference-chat-proposal.png');
    await click(a, '수정안 적용');
    const edited = (
      await poll(read, (rows) => {
        if (rows[0]?.id !== inserted.id)
          assert.notEqual(rows[0]?.status, 'failed', JSON.stringify(rows[0]));
        return rows[0]?.id !== inserted.id && rows[0]?.status === 'succeeded';
      })
    )[0];
    assert.equal(edited.presentation_version, 3);
    assert.equal(edited.quality.length, 4);
    assert(edited.quality.every((q) => q.report.passed && q.reused));
    const after = await json(base, root + `/presentations/${edited.id}/slides`);
    assert.equal(after[1].id, slides[1].id);
    assert(after[0].spec.objects.some((o) => o.content.kind === 'reference'));
    await a.waitForSelector('.presentation-output', { visible: true });
    await setViewport(a, { width: 390, height: 844 });
    await a.$eval('.presentation-deck', (n) => n.scrollIntoView({ block: 'start' }));
    assert(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await capture(a, 'reference-editor-phone.png');
    await b.goto(route, { waitUntil: 'networkidle0' });
    await b.waitForSelector('.presentation-output', { visible: true });
    assert.equal(await b.$('.work-dock'), null);
    const download = await fetch(base + root + `/presentations/${edited.id}/download`);
    assert.equal(download.status, 200);
    assert((await download.arrayBuffer()).byteLength > 1000);
    const calls = fixture.calls();
    await server.stop();
    await server.start();
    assert.equal((await read())[0].id, edited.id);
    await delay(800);
    assert.equal(fixture.calls(), calls);
    assert.deepEqual(errors, []);
    console.log(
      'PASS: no generation reference picker, explicit API references, native source-slide/chart/image output, editor insertion, scoped chat preview/approval, immutable shared revisions, mobile, download and restart',
    );
  } finally {
    if (browser) await browser.close();
    await server.close();
    await fixture.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
