// Purpose: Exercise real slide chat, explicit proposal apply and preserved native PPTX content.
// Pattern: Isolated app/storage; synthetic initial deck, with opt-in live Ornith editing only.
// Usage: PREM_EDIT_MODEL=ornith node tests/e2e/slide-chat.cjs after pnpm build.
// Related: outline-fixture.cjs, backend/tests/slide_edits.rs, tests/.artifacts/captures/folio/.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { createServer } = require('./server.cjs');
const { model, json } = require('./outline-fixture.cjs');
const { upload, ready } = require('./related-fixture.cjs');
const { compare, touchCompare, state: previewState } = require('./canvas-history.cjs');
const { openBrowser, projectRoot } = require('../helpers/browser.cjs');
async function poll(read, done, limit = 90000) {
  const end = Date.now() + limit;
  while (Date.now() < end) {
    const value = await read();
    if (done(value)) return value;
    await delay(150);
  }
  throw Error('Timed out waiting for durable work');
}
async function click(page, name, role = 'button') {
  const node = await page.waitForSelector(`::-p-aria(${name}[role="${role}"])`, { visible: true });
  await node.evaluate((n) => n.scrollIntoView({ block: 'center' }));
  await node.click();
}
(async () => {
  const live = process.env.PREM_EDIT_MODEL === 'ornith';
  const server = await createServer('slide-chat-'),
    fixture = await model();
  let browser;
  try {
    await server.start();
    const base = server.base;
    const p = await json(base, '/api/v1/projects', 'POST', {
      name: '대화 수정 검증',
      due_date: '2030-01-01',
    });
    const author = randomUUID();
    await json(base, `/api/v1/admin/llm/providers/${author}`, 'PUT', {
      expected_version: 0,
      name: '초안 작성 AI',
      provider_type: 'openai_compatible',
      base_url: fixture.base,
      model_identifier: 'outline-fixture',
      timeout_seconds: 30,
      enabled: true,
    });
    await json(base, '/api/v1/admin/document-processing/settings', 'PUT', {
      expected_version: 0,
      connection_id: author,
    });
    const source = await upload(
      base,
      p.id,
      '검증 문서.md',
      '# 업무 현황\n\n이번 분기에는 문서 검토 절차를 정리했습니다.\n\n## 실행 계획\n\n다음 분기에는 검토 항목을 공유하고 담당 업무를 확인합니다.',
    );
    await ready(base, p.id, source);
    const root = `/api/v1/projects/${p.id}`;
    const review = await json(base, root + '/source-review');
    await json(base, root + '/source-review', 'PUT', { snapshot: review.snapshot });
    await json(base, root + '/guide', 'PUT', {
      expected_version: 0,
      do_text: '원문에 있는 내용만 간결하게 작성',
      dont_text: '수치를 만들지 않음',
    });
    const outline = await json(base, root + '/outline');
    await json(base, root + '/outline/runs', 'POST', {
      expected_version: 0,
      source_snapshot: outline.source_snapshot,
      guide_version: 1,
      connection_id: author,
      model_version: 1,
      kind: 'generate',
      node_ids: [],
    });
    const composed = await poll(
      () => json(base, root + '/outline'),
      (s) => {
        assert.notEqual(s.run?.status, 'failed', JSON.stringify(s));
        return s.run?.status === 'succeeded';
      },
    );
    await json(base, root + '/outline/confirm', 'POST', { expected_version: composed.version });
    const prep = await json(base, root + '/presentation-preparation');
    const evidence = await json(base, root + '/presentation-preparation/evidence', 'POST', {
      fingerprint: prep.fingerprint,
    });
    const design = await json(base, root + '/presentation-preparation/design', 'PUT', {
      expected_version: evidence.version,
      evidence_review_id: evidence.evidence_review_id,
      template_job_id: null,
    });
    const created = await json(base, root + '/presentations', 'POST', {
      design_id: design.design_id,
      title: '수정 검증 발표자료',
      instructions: '',
      connection_id: author,
      model_version: 1,
      presentation_id: null,
      expected_version: 0,
    });
    const finished = await poll(
      () => json(base, root + '/presentations'),
      (rows) => {
        assert.notEqual(rows[0].status, 'failed', JSON.stringify(rows[0]));
        return rows[0].status === 'succeeded';
      },
    );
    const original = finished[0],
      before = await json(base, root + `/presentations/${created.id}/slides`);
    const editor = author;
    const label = live ? 'Ornith 1.5 35B' : '수정 AI';
    await json(base, `/api/v1/admin/llm/providers/${editor}`, 'PUT', {
      expected_version: 1,
      name: label,
      provider_type: live ? 'lm_studio_native' : 'openai_compatible',
      base_url: live ? 'http://127.0.0.1:1234/api/v1' : fixture.base,
      model_identifier: live ? 'ornith-1.5-35b-a3b' : 'outline-fixture',
      timeout_seconds: 180,
      enabled: true,
    });
    const priorRequests = new Set(
      (await json(base, `/api/v1/admin/llm/providers/${editor}/requests`)).map((r) => r.id),
    );
    browser = await openBrowser(live ? 'ornith-slide-chat' : 'slide-chat');
    const page = await browser.browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewport({ width: 1440, height: 1000, hasTouch: true });
    await page.goto(base + `/home/studio/${p.id}?step=generation`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.presentation-output');
    assert.equal(await page.$('.slide-chat [role="combobox"]'), null);
    const prompt =
      '제목을 정확히 "검증 완료"로 바꿔주세요. 본문과 발표 메모, 참고 자료는 바꾸지 마세요.';
    await page.focus('#slide-edit-prompt');
    await page.waitForFunction(() => document.activeElement?.id === 'slide-edit-prompt');
    await page.type('#slide-edit-prompt', prompt, { delay: 30 });
    assert.equal(await page.$eval('#slide-edit-prompt', (n) => n.value), prompt);
    await click(page, '슬라이드 정보 패널 접기');
    await click(page, '슬라이드 정보 패널 펼치기');
    assert.equal(await page.$eval('#slide-edit-prompt', (n) => n.value), prompt);
    const start = Date.now();
    await click(page, '수정 요청 보내기');
    const thread = root + `/presentations/${original.id}/slides/${before[0].id}/edits`;
    const proposals = await poll(
      () => json(base, thread),
      (rows) => {
        assert.notEqual(rows.at(-1)?.status, 'failed', JSON.stringify(rows.at(-1)));
        return rows.at(-1)?.status === 'ready';
      },
      240000,
    );
    const proposal = proposals.at(-1);
    assert.equal(proposal.proposal.title, '검증 완료');
    assert.deepEqual(proposal.proposal.bullets, before[0].spec.bullets);
    assert.equal(proposal.proposal.notes, before[0].spec.notes);
    assert.deepEqual(proposal.proposal.block_ids, before[0].spec.block_ids);
    assert.equal((await json(base, root + '/presentations')).length, 1);
    await previewState(page, 'proposal');
    await compare(page, 'proposal', 'presentation-proposal-before');
    await page.$eval('.presentation-deck', (n) => n.scrollIntoView({ block: 'start' }));
    await page.screenshot({
      path: path.join(
        projectRoot,
        `tests/.artifacts/captures/folio/${live ? 'ornith-' : ''}slide-proposal.png`,
      ),
    });
    await click(page, '수정안 적용');
    const applied = await poll(
      () => json(base, root + '/presentations'),
      (rows) => {
        if (rows[0].id !== original.id)
          assert.notEqual(rows[0].status, 'failed', JSON.stringify(rows[0]));
        return rows[0].id !== original.id && rows[0].status === 'succeeded';
      },
    );
    const next = applied[0],
      after = await json(base, root + `/presentations/${next.id}/slides`);
    assert.equal(next.presentation_version, 2);
    assert.equal(after[0].spec.title, '검증 완료');
    assert.deepEqual(after[0].spec.bullets, before[0].spec.bullets);
    assert.equal(after[0].spec.notes, before[0].spec.notes);
    assert.equal(after[1].id, before[1].id);
    assert.deepEqual(after[1].spec, before[1].spec);
    const old = await json(base, root + `/presentations/${original.id}/slides`);
    assert.deepEqual(old, before);
    const response = await fetch(base + root + `/presentations/${next.id}/download`);
    assert.equal(response.status, 200);
    const output = path.join(projectRoot, `tests/.artifacts/${live ? 'ornith-' : ''}edited.pptx`);
    await fs.writeFile(output, Buffer.from(await response.arrayBuffer()));
    const requests = (await json(base, `/api/v1/admin/llm/providers/${editor}/requests`)).filter(
      (r) => !priorRequests.has(r.id),
    );
    assert.equal(requests.length, 1);
    assert.equal(requests[0].status, 'succeeded');
    await previewState(page, 'current');
    await compare(page, 'current', 'presentation-published-before');
    await page.$eval('.presentation-deck', (n) => n.scrollIntoView({ block: 'start' }));
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.presentation-deck img')].every(
        (n) => n.complete && n.naturalWidth > 0,
      ),
    );
    await page.screenshot({
      path: path.join(
        projectRoot,
        `tests/.artifacts/captures/folio/${live ? 'ornith-' : ''}slide-edited.png`,
      ),
    });
    await page.setViewport({ width: 390, height: 844, hasTouch: true });
    await touchCompare(page, 'current');
    await page.$eval('.slide-chat', (n) => n.scrollIntoView({ block: 'start' }));
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({
      path: path.join(
        projectRoot,
        `tests/.artifacts/captures/folio/${live ? 'ornith-' : ''}slide-chat-phone.png`,
      ),
    });
    await page.setViewport({ width: 1440, height: 1000, hasTouch: true });
    await page.waitForSelector('button[aria-label="이전 상태로 되돌리기"]:not(:disabled)');
    await click(page, '이전 상태로 되돌리기');
    const restored = await poll(
      () => json(base, root + '/presentations'),
      (rows) => rows[0].id !== next.id && rows[0].presentation_version === 3,
    );
    const restoredSlides = await json(base, root + `/presentations/${restored[0].id}/slides`);
    assert.deepEqual(
      restoredSlides.map((s) => s.spec),
      before.map((s) => s.spec),
    );
    await page.waitForFunction(
      () => document.querySelector('.presentation-output')?.getAttribute('alt') === '현황 요약',
    );
    assert(await page.$eval('button[aria-label="이전 상태로 되돌리기"]', (n) => n.disabled));
    await page.$eval('.presentation-deck', (n) => n.scrollIntoView({ block: 'start' }));
    await page.screenshot({
      path: path.join(projectRoot, 'tests/.artifacts/captures/folio/presentation-undo.png'),
    });
    await click(page, 'Home', 'link');
    await page.waitForSelector('.project-workspace');
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(path.join(server.storage, 'db/app.sqlite'), { readOnly: true });
    await poll(
      async () => db.prepare('SELECT count(*) AS n FROM presentation_editor_sessions').get().n,
      (n) => n === 0,
    );
    assert.equal(db.prepare('SELECT count(*) AS n FROM presentation_undo_stack').get().n, 0);
    db.close();
    const report = {
      model: live ? 'ornith-1.5-35b-a3b' : 'synthetic',
      protocol: live ? 'LM Studio Native /api/v1/chat' : 'local contract fixture',
      title_before: before[0].spec.title,
      title_after: after[0].spec.title,
      body_preserved: true,
      notes_preserved: true,
      evidence_preserved: true,
      other_slide_version_reused: true,
      original_revision_preserved: true,
      revision: 2,
      model_calls: requests.length,
      request: requests[0],
      elapsed_ms: Date.now() - start,
      output,
    };
    await fs.writeFile(
      path.join(projectRoot, `tests/.artifacts/${live ? 'ornith-' : ''}slide-edit-report.json`),
      JSON.stringify(report, null, 2),
    );
    assert.deepEqual(errors, []);
    console.log(
      `PASS: ${report.model}, reviewed title-only edit, original/other slide preserved, revision 2, one model call and editable PPTX.`,
    );
  } finally {
    if (browser) await browser.close();
    await server.close();
    await fixture.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
