// Purpose: Verify template blank start, actual artwork drag/resize, scoped writes and model-assisted edits.
// Pattern: Real compiled Rust/React, synthetic templates and isolated browser/storage contexts.
// Usage: After pnpm build; captures stay in mock/captures/folio and no business data is used.
// Related: canvas_authoring.rs, canvas-api.ts, object-selection.tsx, outline-fixture.cjs.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { createServer } = require('./server.cjs');
const { model, json } = require('./outline-fixture.cjs');
const { openBrowser, projectRoot } = require('../../mock/helpers/browser.cjs');
const { poll, click, fill, capture } = require('./canvas-browser-helpers.cjs');
(async () => {
  const server = await createServer('canvas-authoring-'),
    fixture = await model();
  let browser;
  try {
    await server.start();
    const base = server.base;
    const project = await json(base, '/api/v1/projects', 'POST', {
        name: '직접 만드는 발표자료',
        due_date: '2030-01-01',
      }),
      p = project.id,
      root = `/api/v1/projects/${p}`;
    const form = new FormData();
    form.append('title', 'QA 팀 템플릿');
    form.append(
      'file',
      new Blob([
        await fs.readFile(path.join(projectRoot, 'tests/fixtures/documents/native-template.pptx')),
      ]),
      'team.pptx',
    );
    const uploaded = await fetch(base + '/api/v1/space/templates', {
      method: 'POST',
      headers: { 'Idempotency-Key': randomUUID() },
      body: form,
    });
    assert.equal(uploaded.status, 201);
    const asset = await uploaded.json();
    const detail = await poll(
      () => json(base, `/api/v1/space/templates/${asset.id}/processing`),
      (d) => {
        assert.notEqual(d.job.status, 'failed', JSON.stringify(d));
        return d.job.status === 'succeeded';
      },
    );
    const layouts = await json(
        base,
        root + `/presentation-layouts?template_job_id=${detail.job.id}`,
      ),
      layout = layouts.find((l) => !l.slots.length) ?? layouts[0];
    browser = await openBrowser('canvas-authoring');
    const a = await (await browser.browser.createBrowserContext()).newPage(),
      b = await (await browser.browser.createBrowserContext()).newPage();
    const errors = [],
      requests = [];
    a.on('pageerror', (e) => errors.push(e.message));
    a.on('request', (r) => {
      if (r.method() === 'POST' && r.url().endsWith('/canvas'))
        requests.push(JSON.parse(r.postData()));
    });
    await a.setViewport({ width: 1440, height: 1000 });
    await a.goto(base + `/home/studio/${p}`, { waitUntil: 'networkidle0' });
    await click(a, '빈 장표로 직접 작성');
    await click(a, '템플릿', 'combobox');
    await click(a, 'QA 팀 템플릿', 'option');
    await poll(
      () => a.$eval('#blank-layout', (n) => !n.disabled),
      (v) => v,
    );
    await click(a, '장표 배치', 'combobox');
    await click(a, layout.name, 'option');
    await click(a, '빈 장표로 시작');
    const read = () => json(base, root + '/presentations');
    async function done(version) {
      return (
        await poll(read, (rows) => {
          assert.notEqual(rows[0]?.status, 'failed', JSON.stringify(rows[0]));
          return rows[0]?.status === 'succeeded' && rows[0].presentation_version === version;
        })
      )[0];
    }
    async function slides(run) {
      return json(base, root + `/presentations/${run.id}/slides`);
    }
    async function enabled(name) {
      await a.waitForFunction(
        (name) =>
          [...document.querySelectorAll('button')].some(
            (n) => n.getAttribute('aria-label') === name && !n.disabled,
          ),
        {},
        name,
      );
    }
    async function saved(version) {
      const run = await done(version);
      await enabled('도형 추가');
      await delay(150);
      return run;
    }
    let run = await saved(1);
    assert.equal(run.manual, true);
    assert.equal((await slides(run))[0].spec.design.layout_key, layout.key);
    assert.deepEqual(await json(base, '/api/v1/models/authoring'), []);
    await capture(a, 'canvas-template-blank.png');
    await click(a, '도형 추가');
    run = await saved(2);
    let current = (await slides(run))[0],
      shape = current.spec.objects[0];
    assert(shape);
    await a.waitForFunction(
      () => document.querySelector('.canvas-artwork-layers')?.style.visibility === 'visible',
    );
    const button = await a.waitForSelector('::-p-aria(도형 선택[role="button"])', {
      visible: true,
    });
    await button.evaluate((n) => n.scrollIntoView({ block: 'center' }));
    const box = await button.boundingBox();
    const before = requests.length;
    await a.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await a.mouse.down();
    await a.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2 + 40, { steps: 12 });
    await delay(150);
    assert.equal(requests.length, before, 'No writes during pointer motion');
    assert(
      await a.$eval('.canvas-artwork-layers', (n) =>
        [...n.querySelectorAll('img')].some((i) => i.style.transform !== 'none'),
      ),
      'Artwork follows the object during dragging',
    );
    await capture(a, 'canvas-drag-live.png');
    await a.mouse.up();
    run = await saved(3);
    current = (await slides(run))[0];
    assert(current.spec.objects[0].frame.x > shape.frame.x);
    assert.equal(requests.length, before + 1);
    await enabled('선택한 객체 위치·크기');
    const selected = await a.waitForSelector('.canvas-object-handle[aria-pressed="true"]', {
      visible: true,
    });
    await selected.focus();
    await a.keyboard.press('ArrowRight');
    const prior = current.spec.objects[0].frame;
    run = await saved(4);
    current = (await slides(run))[0];
    assert(Math.abs(current.spec.objects[0].frame.x - prior.x - 1) < 0.002);
    const unchanged = run.id,
      count = requests.length,
      target = await a.$('.canvas-object-handle[aria-pressed="true"]'),
      rect = await target.boundingBox();
    await a.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await a.mouse.down();
    await a.mouse.move(rect.x + rect.width / 2 + 50, rect.y + rect.height / 2 + 20, { steps: 6 });
    await a.keyboard.press('Escape');
    await a.mouse.up();
    await delay(700);
    assert.equal((await read())[0].id, unchanged);
    assert.equal(requests.length, count, 'Escape never commits');
    await click(a, '선택한 객체 위치·크기');
    await fill(a, '#canvas-x', '25');
    await click(a, '배치 적용');
    run = await saved(5);
    assert.equal((await slides(run))[0].spec.objects[0].frame.x, 25);
    const handles = await a.$$('.canvas-object-target.is-selected .canvas-resize-handle');
    const handleBoxes = await Promise.all(
      handles.map(async (n) => ({ n, b: await n.boundingBox() })),
    );
    const chosenCorner = handleBoxes
      .filter((v) => v.b)
      .sort((x, y) => y.b.x + y.b.y - (x.b.x + x.b.y))[0];
    await chosenCorner.n.evaluate((n) => n.scrollIntoView({ block: 'center', inline: 'nearest' }));
    const corner = await chosenCorner.n.boundingBox();
    const resizeBefore = (await slides(run))[0].spec.objects[0].frame;
    const beforeResize = requests.length;
    const resizeHit = await a.evaluate((b) => {
      const n = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      return { tag: n?.tagName, classes: n?.className };
    }, corner);
    await a.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2);
    await a.mouse.down();
    await a.mouse.move(corner.x + corner.width / 2 + 40, corner.y + corner.height / 2 + 20, {
      steps: 8,
    });
    await a.mouse.up();
    await delay(400);
    if (requests.length === beforeResize) {
      await capture(a, 'canvas-resize-diagnostic.png');
      throw Error('Resize did not submit: ' + JSON.stringify(resizeHit));
    }
    run = await saved(6);
    const resized = (await slides(run))[0].spec.objects[0].frame;
    assert(resized.width > resizeBefore.width);
    await click(a, '텍스트 추가');
    run = await saved(7);
    await click(a, '선택한 텍스트 수정');
    await fill(a, '#canvas-text', '근거를 바탕으로 직접 작성');
    await click(a, '내용 적용');
    run = await saved(8);
    current = (await slides(run))[0];
    assert.equal(
      current.spec.objects.find((o) => o.content.kind === 'text').content.text,
      '근거를 바탕으로 직접 작성',
    );
    assert.deepEqual(current.spec.objects.find((o) => o.id === shape.id).frame, resized);
    const selectionModifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    const behind = await a.waitForSelector('::-p-aria(도형 선택[role="button"])', {
      visible: true,
    });
    await behind.evaluate((n) => n.scrollIntoView({ block: 'center' }));
    const behindBox = await behind.boundingBox();
    await a.keyboard.down(selectionModifier);
    await a.mouse.click(behindBox.x + behindBox.width - 12, behindBox.y + behindBox.height / 2);
    await a.keyboard.up(selectionModifier);
    assert.equal(
      await a.$$eval('.canvas-object-handle[aria-pressed="true"]', (nodes) => nodes.length),
      2,
    );
    await (await a.$('.canvas-object-handle[aria-pressed="true"]')).focus();
    await a.keyboard.press('ArrowUp');
    run = await saved(9);
    assert.equal(requests.at(-1).operation.placements.length, 2);
    await enabled('새 슬라이드');
    await click(a, '새 슬라이드');
    await click(a, layout.name, 'menuitem');
    run = await saved(10);
    assert.equal(run.total, 2);
    await click(a, '슬라이드 2 메뉴');
    await click(a, '슬라이드 복제', 'menuitem');
    run = await saved(11);
    assert.equal(run.total, 3);
    await click(a, '슬라이드 3 메뉴');
    await click(a, '슬라이드 삭제', 'menuitem');
    run = await saved(12);
    assert.equal(run.total, 2);
    await enabled('이전 상태로 되돌리기');
    await click(a, '이전 상태로 되돌리기');
    run = await saved(13);
    assert.equal(run.total, 3);
    await a.$eval('.presentation-deck', (n) => n.scrollIntoView({ block: 'start' }));
    await capture(a, 'canvas-direct-editing.png');
    await b.goto(base + `/home/studio/${p}?step=generation`, { waitUntil: 'networkidle0' });
    await b.waitForSelector('.presentation-output', { visible: true });
    assert.equal((await read())[0].id, run.id);
    const modelId = randomUUID();
    await json(base, `/api/v1/admin/llm/providers/${modelId}`, 'PUT', {
      expected_version: 0,
      name: '캔버스 작성 AI',
      provider_type: 'openai_compatible',
      base_url: fixture.base,
      model_identifier: 'canvas-fixture',
      timeout_seconds: 60,
      enabled: true,
    });
    await a.click('.presentation-slide-thumb');
    await enabled('도형 추가');
    const shapeHandle = await a.waitForSelector('::-p-aria(도형 선택[role="button"])', {
      visible: true,
    });
    await shapeHandle.evaluate((n) => n.scrollIntoView({ block: 'center' }));
    const shapeRect = await shapeHandle.boundingBox();
    await a.mouse.click(shapeRect.x + shapeRect.width - 12, shapeRect.y + shapeRect.height / 2);
    await click(a, 'AI와 대화', 'tab');
    await a.type('#slide-edit-prompt', '선택한 도형의 위치를 오른쪽으로 옮겨주세요.');
    await click(a, '수정 요청 보내기');
    await poll(
      () =>
        a
          .$eval('.slide-edit-proposal', (n) => n.textContent.includes('수정안 적용'))
          .catch(() => false),
      (v) => v,
    );
    await click(a, '수정안 적용');
    run = await saved(14);
    assert.equal(fixture.calls(), 1);
    const finalSlide = (await slides(run))[0];
    assert.equal(finalSlide.spec.objects.find((o) => o.id === shape.id).frame.x, 50);
    assert.equal(
      finalSlide.spec.objects.find((o) => o.content.kind === 'text').content.text,
      '근거를 바탕으로 직접 작성',
    );
    await a.$eval('.presentation-deck', (n) => n.scrollIntoView({ block: 'start' }));
    await capture(a, 'canvas-direct-editing.png');
    await a.setViewport({ width: 390, height: 844 });
    await a.$eval('.presentation-deck', (n) => n.scrollIntoView({ block: 'start' }));
    await a
      .waitForFunction(() => document.documentElement.scrollWidth <= innerWidth + 1, {
        timeout: 4000,
      })
      .catch(async () => {
        await capture(a, 'canvas-phone-diagnostic.png');
        const overflow = await a.evaluate(() =>
          [...document.querySelectorAll('body *')]
            .map((n) => {
              const r = n.getBoundingClientRect();
              return {
                tag: n.tagName,
                classes: n.className,
                left: r.left,
                right: r.right,
                width: r.width,
                position: getComputedStyle(n).position,
              };
            })
            .filter((r) => r.width > 0 && r.right > innerWidth + 1)
            .sort((a, b) => b.right - a.right)
            .slice(0, 12),
        );
        throw Error('Mobile overflow: ' + JSON.stringify(overflow));
      });
    await capture(a, 'canvas-direct-phone.png');
    const download = await fetch(base + root + `/presentations/${run.id}/download`);
    assert.equal(download.status, 200);
    assert((await download.arrayBuffer()).byteLength > 1000);
    const callCount = fixture.calls();
    await server.stop();
    await server.start();
    assert.equal((await read())[0].id, run.id);
    assert.equal(fixture.calls(), callCount);
    assert.deepEqual(errors, []);
    console.log(
      'PASS: no-model template blank start, live artwork dragging, one commit per gesture, resize, keyboard/numeric alternatives, Escape, text, multi-selection, slide lifecycle, undo, shared contexts, chat, mobile and restart',
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
