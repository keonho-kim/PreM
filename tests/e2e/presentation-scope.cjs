// Purpose: Verify selecting branches and individual sections produces only that real PPTX scope.
// Pattern: Isolated application, deterministic local model, actual UI/native output and two browsers.
// Usage: After pnpm build, set PREM_BROWSER_TOOLS and run this file.
// Related: presentation_scope.rs, generation-scope.tsx, outline-fixture.cjs.
const assert = require('node:assert/strict');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createServer } = require('./server.cjs');
const { model, json } = require('./outline-fixture.cjs');
const { upload, ready } = require('./related-fixture.cjs');
const { openBrowser, projectRoot } = require('../helpers/browser.cjs');
const { poll, click } = require('./canvas-browser-helpers.cjs');
(async () => {
  const server = await createServer('presentation-scope-'),
    fixture = await model();
  let browser;
  try {
    await server.start();
    const base = server.base;
    const p = (
      await json(base, '/api/v1/projects', 'POST', {
        name: '선택한 목차 발표',
        due_date: '2030-01-01',
      })
    ).id;
    const root = `/api/v1/projects/${p}`,
      connection = randomUUID();
    await json(base, `/api/v1/admin/llm/providers/${connection}`, 'PUT', {
      expected_version: 0,
      name: '발표 작성 AI',
      provider_type: 'openai_compatible',
      base_url: fixture.base,
      model_identifier: 'outline-fixture',
      timeout_seconds: 30,
      enabled: true,
    });
    await json(base, '/api/v1/admin/document-processing/settings', 'PUT', {
      expected_version: 0,
      connection_id: connection,
    });
    const source = await upload(
      base,
      p,
      'source.md',
      '# 업무 현황\n\n현재 운영 상황과 개선 사항을 확인합니다.\n\n## 실행 계획\n\n다음 분기 업무 일정과 담당 역할을 정리합니다.',
    );
    await ready(base, p, source);
    const review = await json(base, root + '/source-review');
    await json(base, root + '/source-review', 'PUT', { snapshot: review.snapshot });
    await json(base, root + '/guide', 'PUT', {
      expected_version: 0,
      do_text: '원문 근거를 사용',
      dont_text: '새 수치 생성 금지',
    });
    const empty = await json(base, root + '/outline');
    await json(base, root + '/outline/runs', 'POST', {
      expected_version: 0,
      source_snapshot: empty.source_snapshot,
      guide_version: 1,
      connection_id: connection,
      model_version: 1,
      kind: 'generate',
      node_ids: [],
    });
    const outline = await poll(
      () => json(base, root + '/outline'),
      (s) => s.run?.status === 'succeeded',
    );
    const major = randomUUID(),
      child = randomUUID();
    outline.draft.nodes.push(
      { id: major, parent_id: null, title: '후속 계획', description: '' },
      { id: child, parent_id: major, title: '후속 조치', description: '' },
    );
    outline.draft.assignments.push({
      node_id: child,
      block_id: outline.draft.assignments[0].block_id,
    });
    const saved = await json(base, root + '/outline', 'PUT', {
      expected_version: outline.version,
      source_snapshot: outline.source_snapshot,
      guide_version: 1,
      draft: outline.draft,
    });
    await json(base, root + '/outline/confirm', 'POST', { expected_version: saved.version });
    const pre = await json(base, root + '/presentation-preparation');
    const evidence = await json(base, root + '/presentation-preparation/evidence', 'POST', {
      fingerprint: pre.fingerprint,
    });
    await json(base, root + '/presentation-preparation/design', 'PUT', {
      expected_version: evidence.version,
      evidence_review_id: evidence.evidence_review_id,
      template_job_id: null,
    });
    browser = await openBrowser('presentation-scope');
    const page = await (await browser.browser.createBrowserContext()).newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewport({ width: 1440, height: 1100, hasTouch: true });
    const route = base + `/home/studio/${p}?step=generation`;
    await page.goto(route, { waitUntil: 'networkidle0' });
    await page.waitForSelector('::-p-aria(전체 목차[role="checkbox"])', { visible: true });
    assert.equal(await page.$('::-p-aria(PPT 생성 설정[role="button"])'), null);
    assert.equal(await page.$('::-p-aria(레퍼런스 넣기[role="button"])'), null);
    assert(await page.$eval('.presentation-composer', (n) => !n.closest('[hidden]')));
    assert(
      (await page.$eval('.generation-scope-summary', (n) => n.textContent)).includes('3개 선택'),
    );
    await click(page, '전체 목차', 'checkbox');
    await click(page, 'PPT 만들기');
    assert(
      (await page.$eval('.presentation-form [role=alert]', (n) => n.textContent)).includes(
        '하나 이상',
      ),
    );
    await click(page, '업무 현황', 'checkbox');
    await click(page, '현황 요약', 'checkbox');
    const parent = await page.$('::-p-aria(업무 현황[role="checkbox"])');
    assert.equal(await parent.evaluate((n) => n.getAttribute('aria-checked')), 'mixed');
    const later = await page.$('::-p-aria(후속 조치[role="checkbox"])');
    await later.focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('Space');
    await page.$eval('.generation-scope', (n) => n.scrollIntoView({ block: 'center' }));
    await page.screenshot({
      path: path.join(
        projectRoot,
        'tests/.artifacts/captures/folio/presentation-scope-desktop.png',
      ),
    });
    await page.setViewport({ width: 390, height: 844, hasTouch: true });
    await page.$eval('.generation-scope', (n) => n.scrollIntoView({ block: 'center' }));
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert(await parent.evaluate((n) => n.closest('label').getBoundingClientRect().height >= 48));
    await page.screenshot({
      path: path.join(projectRoot, 'tests/.artifacts/captures/folio/presentation-scope-phone.png'),
    });
    await page.setViewport({ width: 1440, height: 1100, hasTouch: true });
    assert.equal(await page.$('#presentation-model'), null);
    const beforeCalls = fixture.calls();
    await click(page, 'PPT 만들기');
    const run = (
      await poll(
        () => json(base, root + '/presentations'),
        (rows) => {
          assert.notEqual(rows[0]?.status, 'failed', JSON.stringify(rows[0]));
          return rows[0]?.status === 'succeeded';
        },
      )
    )[0];
    assert.equal(run.total, 1);
    assert.equal(fixture.calls(), beforeCalls + 1);
    const slides = await json(base, root + `/presentations/${run.id}/slides`);
    assert.equal(slides.length, 1);
    assert.equal(slides[0].spec.title, '실행 계획');
    await page.waitForSelector('.presentation-output', { visible: true });
    assert(
      await page.evaluate(() => {
        const editor = document.querySelector('.presentation-output');
        const composer = document.querySelector('.presentation-composer');
        return !!(editor.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING);
      }),
    );
    assert.equal(await page.$('::-p-aria(직접 작성[role="tab"])'), null);
    assert.equal(await parent.evaluate((n) => n.getAttribute('aria-checked')), 'mixed');
    await click(page, '발표자료 더보기');
    await click(page, '새 버전 만들기', 'menuitem');
    assert.equal(await page.$eval('#presentation-title', (n) => n.value), run.title);
    assert(await page.$eval('#presentation-title', (n) => n === document.activeElement));
    assert.equal(fixture.calls(), beforeCalls + 1);
    await page.$eval('.presentation-command-row', (n) => n.scrollIntoView({ block: 'start' }));
    await page.screenshot({
      path: path.join(
        projectRoot,
        'tests/.artifacts/captures/folio/presentation-inline-editor.png',
      ),
    });
    const other = await (await browser.browser.createBrowserContext()).newPage();
    await other.goto(route, { waitUntil: 'networkidle0' });
    await other.waitForSelector('.presentation-output', { visible: true });
    assert.equal((await json(base, root + '/presentations'))[0].id, run.id);
    const result = await fetch(base + root + `/presentations/${run.id}/download`);
    assert.equal(result.status, 200);
    assert(
      Buffer.from(await result.arrayBuffer())
        .subarray(0, 2)
        .equals(Buffer.from('PK')),
    );
    // Row actions preserve selection; title/child/reorder edits persist without regenerating a deck.
    await click(page, '업무 현황 수정');
    await page.waitForSelector('.outline-edit-dialog', { visible: true });
    await page.locator(`#outline-title-${outline.draft.nodes[0].id}`).fill('검토한 업무 현황');
    await click(page, '목차 저장');
    await page.waitForSelector('.outline-edit-dialog', { hidden: true });
    assert.equal((await json(base, root + '/outline')).draft.nodes[0].title, '검토한 업무 현황');
    await click(page, '검토한 업무 현황에 중목차 추가');
    await page.waitForSelector('.outline-edit-dialog', { visible: true });
    await page.waitForFunction(() => document.activeElement?.value === '새 중목차');
    await page.keyboard.type(' 보완');
    await click(page, '새 중목차 보완 위로');
    await click(page, '목차 저장');
    await page.waitForSelector('.outline-edit-dialog', { hidden: true });
    const changed = await json(base, root + '/outline');
    assert.equal(changed.draft.nodes[0].title, '검토한 업무 현황');
    assert.equal(changed.draft.nodes[2].title, '새 중목차 보완');
    assert.equal(changed.confirmed, true);
    assert.equal((await json(base, root + '/presentations')).length, 1);
    await page.$eval('.generation-scope', (n) => n.scrollIntoView({ block: 'center' }));
    await page.screenshot({
      path: path.join(
        projectRoot,
        'tests/.artifacts/captures/folio/generation-outline-actions.png',
      ),
    });
    await server.stop();
    await server.start();
    assert.equal((await json(base, root + '/presentations'))[0].id, run.id);
    assert.equal(fixture.calls(), beforeCalls + 1);
    assert.deepEqual(errors, []);
    console.log(
      'PASS: inline creation, editor-first output, draft/tab focus, branch/leaf selection, keyboard/mobile, scoped PPTX, shared contexts and restart',
    );
  } finally {
    await browser?.close();
    await server.close();
    await fixture.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
