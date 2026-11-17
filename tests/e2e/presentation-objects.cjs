// Purpose: Verify object insertion and reviewed multi-slide edits through the actual Studio UI.
// Pattern: Isolated server/storage, real native PPTX, optional local Ornith for one batch.
// Usage: PREM_EDIT_MODEL=ornith node tests/e2e/presentation-objects.cjs after pnpm build.
// Related: slide-chat.cjs, object-fixture.cjs, backend/tests/presentation_objects.rs.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { createServer } = require('./server.cjs');
const { model, json } = require('./outline-fixture.cjs');
const { upload, ready } = require('./related-fixture.cjs');
const { openBrowser, projectRoot } = require('../helpers/browser.cjs');
async function poll(read, done, limit = 180000) {
  const end = Date.now() + limit;
  while (Date.now() < end) {
    const value = await read();
    if (done(value)) return value;
    await delay(150);
  }
  throw Error('Timed out');
}
async function click(page, name, role = 'button') {
  const node = await page.waitForSelector(`::-p-aria(${name}[role="${role}"])`, { visible: true });
  await node.evaluate((n) => n.scrollIntoView({ block: 'center' }));
  await node.click();
}
(async () => {
  const live = process.env.PREM_EDIT_MODEL === 'ornith';
  const server = await createServer('object-browser-'),
    fixture = await model();
  let browser;
  const trace =
    live && process.env.PREM_TRACE_EDIT === '1'
      ? await require('./native-edit-trace.cjs')(projectRoot)
      : null;
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
    const editor = author,
      label = live ? 'Ornith 객체 편집' : '객체 수정 AI';
    await json(base, `/api/v1/admin/llm/providers/${editor}`, 'PUT', {
      expected_version: 1,
      name: label,
      provider_type: live ? 'lm_studio_native' : 'openai_compatible',
      base_url: live ? (trace?.base ?? 'http://127.0.0.1:1234/api/v1') : fixture.base,
      model_identifier: live ? 'ornith-1.5-35b-a3b' : 'outline-fixture',
      timeout_seconds: 180,
      enabled: true,
    });
    const priorRequests = new Set(
      (await json(base, `/api/v1/admin/llm/providers/${editor}/requests`)).map((r) => r.id),
    );
    browser = await openBrowser('presentation-objects');
    const page = await browser.browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto(base + `/home/studio/${p.id}?step=generation`, { waitUntil: 'networkidle0' });
    await click(page, '객체', 'tab');
    const input = await page.waitForSelector('#slide-image-file');
    await input.uploadFile(path.join(projectRoot, 'tests/fixtures/documents/scan.png'));
    await click(page, '이미지 등록');
    await page.waitForSelector('.slide-media-gallery img');
    await click(page, '전체 선택');
    await click(page, 'AI와 대화', 'tab');
    assert.equal(await page.$('.slide-chat [role="combobox"]'), null);
    const prompt =
      '각 장표 오른쪽에 등록된 scan.png 이미지와 막대 차트(제목: 실적, 항목: A, B, 건수: 10, 20), 작은 사각형을 추가하세요. 차트는 x55 y20 너비40 높이35, 이미지는 x55 y60 너비30 높이20, 사각형은 x55 y85 너비35 높이5에 배치하세요. 본문은 x5 y30 너비40 높이60, 제목은 x5 y10 너비90 높이15로 배치하고 기존 텍스트와 메모는 유지하세요.';
    await page.focus('#slide-edit-prompt');
    await page.type('#slide-edit-prompt', prompt, { delay: 10 });
    assert.equal(await page.$eval('#slide-edit-prompt', (n) => n.value), prompt);
    await click(page, '수정 요청 보내기');
    const thread = root + `/presentations/${original.id}/slides/${before[0].id}/edits`;
    const rows = await poll(
      () => json(base, thread),
      (rows) => {
        assert.notEqual(rows.at(-1)?.status, 'failed', JSON.stringify(rows.at(-1)));
        return rows.at(-1)?.status === 'ready';
      },
      360000,
    );
    const proposal = rows.at(-1);
    assert.equal(proposal.slides.length, 2);
    for (const s of proposal.slides) {
      assert(s.proposal.objects.some((o) => o.content.kind === 'image'));
      assert(s.proposal.objects.some((o) => o.content.kind === 'chart'));
      assert.deepEqual(s.before.bullets, s.proposal.bullets);
    }
    assert.equal((await json(base, root + '/presentations')).length, 1);
    await page.waitForSelector('.presentation-output[data-preview=proposal]');
    await page.$eval('.presentation-deck', (n) => n.scrollIntoView({ block: 'start' }));
    await page.screenshot({
      path: path.join(
        projectRoot,
        `tests/.artifacts/captures/folio/${live ? 'ornith-' : ''}object-proposal.png`,
      ),
    });
    await click(page, '수정안 적용');
    const runs = await poll(
      () => json(base, root + '/presentations'),
      (rows) => {
        if (rows[0].id !== original.id)
          assert.notEqual(rows[0].status, 'failed', JSON.stringify(rows[0]));
        return rows[0].id !== original.id && rows[0].status === 'succeeded';
      },
    );
    const next = runs[0],
      after = await json(base, root + `/presentations/${next.id}/slides`);
    assert.equal(next.presentation_version, 2);
    for (let i = 0; i < 2; i++) {
      assert.equal(after[i].spec.schema_version, 2);
      assert.deepEqual(after[i].spec.bullets, before[i].spec.bullets);
      assert.equal(after[i].spec.notes, before[i].spec.notes);
    }
    assert.deepEqual(await json(base, root + `/presentations/${original.id}/slides`), before);
    await page.waitForFunction(
      () => document.querySelectorAll('.slide-object-selection button').length >= 3,
    );
    await page.$eval('.presentation-deck', (n) => n.scrollIntoView({ block: 'start' }));
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.presentation-deck img')].every(
        (n) => n.complete && n.naturalWidth > 0,
      ),
    );
    await page.screenshot({
      path: path.join(
        projectRoot,
        `tests/.artifacts/captures/folio/${live ? 'ornith-' : ''}object-edited.png`,
      ),
    });
    await click(page, '객체', 'tab');
    await page.waitForSelector('.slide-object-list button');
    const buttons = await page.$$('.slide-object-list button');
    await buttons[0].click();
    await page.waitForFunction(
      () =>
        document.querySelectorAll('.slide-object-list button[aria-pressed="true"]').length === 1,
    );
    await page.keyboard.down(process.platform === 'darwin' ? 'Meta' : 'Control');
    await buttons[1].click();
    await page.keyboard.up(process.platform === 'darwin' ? 'Meta' : 'Control');
    await page.waitForFunction(
      () =>
        document.querySelectorAll('.slide-object-list button[aria-pressed="true"]').length === 2,
    );
    assert.equal(
      await page.$$eval('.slide-object-list button[aria-pressed="true"]', (nodes) => nodes.length),
      2,
    );
    await click(page, '선택한 2개 수정 요청');
    assert(
      (await page.$eval('.slide-chat-target', (n) => n.textContent)).includes('선택한 객체 2개만'),
    );
    await page.setViewport({ width: 390, height: 844 });
    await page.waitForFunction(
      () =>
        parseFloat(document.documentElement.style.getPropertyValue('--studio-sticky-height')) >=
        document.querySelector('.app-header').getBoundingClientRect().height +
          document.querySelector('.studio-stepper').getBoundingClientRect().height -
          1,
    );
    await page.$eval('.slide-chat', (n) => n.scrollIntoView({ block: 'start' }));
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({
      path: path.join(
        projectRoot,
        `tests/.artifacts/captures/folio/${live ? 'ornith-' : ''}object-phone.png`,
      ),
    });
    const shared = await browser.browser.createBrowserContext();
    try {
      const other = await shared.newPage();
      await other.goto(base + `/home/studio/${p.id}?step=generation`, {
        waitUntil: 'networkidle0',
      });
      await other.waitForFunction(
        () => document.querySelectorAll('.slide-object-selection button').length >= 3,
      );
    } finally {
      await shared.close();
    }
    const response = await fetch(base + root + `/presentations/${next.id}/download`);
    assert.equal(response.status, 200);
    const output = path.join(
      projectRoot,
      `tests/.artifacts/${live ? 'ornith-' : ''}object-edited.pptx`,
    );
    await fs.writeFile(output, Buffer.from(await response.arrayBuffer()));
    const requests = (await json(base, `/api/v1/admin/llm/providers/${editor}/requests`)).filter(
      (r) => !priorRequests.has(r.id),
    );
    assert.equal(requests.length, 2);
    assert(requests.every((r) => r.status === 'succeeded'));
    await fs.writeFile(
      path.join(projectRoot, `tests/.artifacts/${live ? 'ornith-' : ''}object-edit-report.json`),
      JSON.stringify(
        {
          model: live ? 'ornith-1.5-35b-a3b' : 'synthetic',
          slides: 2,
          objects: after.map((s) => s.spec.objects),
          model_calls: requests.length,
          requests,
          body_notes_preserved: true,
          original_preserved: true,
          revision: 2,
          output,
        },
        null,
        2,
      ),
    );
    assert.deepEqual(errors, []);
    console.log(
      `PASS: ${live ? 'Ornith' : 'synthetic'} images/charts/shapes, two-slide atomic apply, multi-object selection, mobile and native PPTX`,
    );
  } finally {
    if (browser) await browser.close();
    await server.close();
    await fixture.close();
    if (trace) await trace.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
