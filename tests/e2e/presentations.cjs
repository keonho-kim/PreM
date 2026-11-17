// Purpose: Verify Studio's complete path from source upload to a real editable PPTX download.
// Pattern: Isolated product server, synthetic local model and independent browser contexts.
// Usage: After pnpm build; captures under tests/.artifacts/captures/folio and no real data mutations.
// Related: outline-fixture.cjs, backend/tests/presentations.rs.
const assert = require('node:assert/strict');
const { authorizedFetch: fetch } = require('./admin-client.cjs');
const path = require('node:path');
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { createServer } = require('./server.cjs');
const { model, json } = require('./outline-fixture.cjs');
const { openBrowser, projectRoot } = require('../helpers/browser.cjs');
const { notifications } = require('./space-checks.cjs');
async function click(page, name, role = 'button') {
  const target = await page.waitForSelector(`::-p-aria(${name}[role="${role}"])`, {
    visible: true,
  });
  await target.evaluate((n) => n.scrollIntoView({ block: 'center' }));
  await target.click();
}
(async () => {
  const server = await createServer('presentations-browser-'),
    fixture = await model();
  let session;
  try {
    await server.start();
    const templateForm = new FormData();
    templateForm.append('title', '공용 템플릿');
    templateForm.append('tags', '[]');
    templateForm.append(
      'file',
      new Blob([
        await fs.readFile(path.join(projectRoot, 'tests/fixtures/documents/native-template.pptx')),
      ]),
      'team.pptx',
    );
    const templateResponse = await fetch(server.base + '/api/v1/space/templates', {
      method: 'POST',
      headers: { 'Idempotency-Key': randomUUID() },
      body: templateForm,
    });
    assert.equal(templateResponse.status, 201);

    const project = await json(server.base, '/api/v1/projects', 'POST', {
      name: '분기 실행 계획',
      due_date: '2030-01-01',
    });
    const author = randomUUID();
    await json(server.base, `/api/v1/admin/llm/providers/${author}`, 'PUT', {
      expected_version: 0,
      name: '발표 작성 AI',
      provider_type: 'openai_compatible',
      base_url: fixture.base,
      model_identifier: 'outline-fixture',
      timeout_seconds: 30,
      enabled: true,
    });
    await json(server.base, '/api/v1/admin/document-processing/settings', 'PUT', {
      expected_version: 0,
      connection_id: author,
    });
    const rotation = await fetch(server.base + '/api/v1/admin/general', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expected_version: 1, token: 'synthetic-Public-flow-admin-token' }),
    });
    assert.equal(rotation.status, 200);
    session = await openBrowser('presentations');
    const a = await (await session.browser.createBrowserContext()).newPage(),
      b = await (await session.browser.createBrowserContext()).newPage();
    const errors = [];
    for (const page of [a, b]) page.on('pageerror', (e) => errors.push(e.message));
    await a.setViewport({ width: 1440, height: 1000 });
    const route = `${server.base}/home/studio/${project.id}`;
    await a.goto(route, { waitUntil: 'networkidle0' });
    await click(a, '문서 추가');
    await (await a.waitForSelector('.space-dialog input[type=file]')).uploadFile(
      path.join(projectRoot, 'tests/fixtures/documents/reference.md'),
    );
    await a.click('.space-dialog button[type=submit]');
    await a.waitForSelector('.space-dialog', { hidden: true });
    await a.waitForFunction(() => !document.querySelector('.studio-review button')?.disabled);
    await notifications(a, false);
    await click(a, '원본 확인하고 계속');
    await a.waitForSelector('#guide-do', { visible: true });
    await a.type('#guide-do', '실행 계획을 간결하게');
    await click(a, '저장하고 목차로');
    await click(a, '목차 만들기');
    await a.waitForFunction(() =>
      document.querySelector('.outline-save')?.textContent.includes('저장된 버전 1'),
    );
    await click(a, '목차·내용 확정');
    await a.waitForFunction(() =>
      document.querySelector('.outline-save')?.textContent.includes('확정했습니다'),
    );
    await click(a, '근거');
    await a.waitForSelector('.presentation-confirmation', { visible: true });
    await a.waitForFunction(
      () => document.querySelector('.presentation-confirmation button')?.disabled === false,
    );
    await click(a, '근거 확인하고 계속');
    await a.waitForSelector('.presentation-template-grid', { visible: true });
    await a.screenshot({
      path: path.join(projectRoot, 'tests/.artifacts/captures/folio/presentation-templates.png'),
      fullPage: true,
    });
    await a.waitForFunction(
      () =>
        [...document.querySelectorAll('.presentation-template button')].some(
          (n) => n.textContent.includes('이 템플릿 선택') && !n.disabled,
        ),
      { timeout: 60000 },
    );
    await click(a, '공용 템플릿 미리보기');
    await a.waitForSelector('.processing-dialog');
    await a.keyboard.press('Escape');
    await a.waitForSelector('.processing-dialog', { hidden: true });
    await click(a, '이 템플릿 선택');
    await click(a, '기본 디자인 선택');
    await click(a, '이 디자인으로 계속');
    await a.waitForSelector('#presentation-title', { visible: true });
    assert.equal(await a.$('#presentation-model'), null);
    await click(a, 'PPT 만들기');
    await a.waitForSelector('.presentation-output', { visible: true, timeout: 90000 });
    await a.waitForFunction(
      () => document.querySelectorAll('.presentation-workflow-status li').length === 3,
    );
    assert(
      (await a.$eval('.presentation-workflow-status', (n) => n.textContent)).includes(
        '파일 생성·검사',
      ),
    );
    assert.equal(
      await a.$$eval(
        '.presentation-workflow-status li',
        (nodes) => nodes.filter((n) => n.textContent.includes('완료')).length,
      ),
      3,
    );
    assert.equal(await a.$eval('button[aria-label="템플릿"]', (n) => n.disabled), false);
    await a.$eval('.presentation-run-status', (n) => n.scrollIntoView({ block: 'start' }));
    const chrome = await a.evaluate(() => ({
      header: document.querySelector('.app-header').getBoundingClientRect().bottom,
      step: document.querySelector('.studio-stepper').getBoundingClientRect().top,
    }));
    assert.ok(Math.abs(chrome.header - chrome.step) < 2, 'Stepper stays below global navigation');
    const canvasWidth = () =>
      a.$eval('.presentation-slide-reader', (n) => n.getBoundingClientRect().width);
    const originalWidth = await canvasWidth();
    const imageWidth = () =>
      a.$eval('.presentation-output', (n) => n.getBoundingClientRect().width);
    const fittedWidth = await imageWidth();
    await click(a, '슬라이드 확대');
    assert.ok((await imageWidth()) > fittedWidth);
    assert.ok(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await click(a, '화면에 맞추기');
    assert.ok(Math.abs((await imageWidth()) - fittedWidth) < 2);

    await click(a, '다음 슬라이드');
    const selectedTitle = await a.$eval('.presentation-slide-thumb[aria-pressed="true"]', (n) =>
      n.getAttribute('aria-label'),
    );
    await click(a, '슬라이드 목록 접기');
    assert.ok((await canvasWidth()) > originalWidth + 100);
    assert.equal(await a.$eval('.presentation-slide-panel', (n) => n.hidden), true);
    await click(a, '슬라이드 정보 패널 접기');
    assert.ok((await canvasWidth()) > originalWidth + 300);
    assert.equal(await a.$eval('.presentation-inspector', (n) => n.hidden), true);
    await a.screenshot({
      path: path.join(
        projectRoot,
        'tests/.artifacts/captures/folio/presentation-panels-collapsed.png',
      ),
    });
    await click(a, '슬라이드 목록 펼치기');
    assert.equal(
      await a.$eval('.presentation-slide-thumb[aria-pressed="true"]', (n) =>
        n.getAttribute('aria-label'),
      ),
      selectedTitle,
    );
    const expandRight = await a.waitForSelector('button[aria-label="슬라이드 정보 패널 펼치기"]');
    await expandRight.focus();
    await a.keyboard.press('Enter');
    await click(a, '이전 슬라이드');
    await a.$eval('.presentation-run-status', (n) => n.scrollIntoView({ block: 'start' }));
    await a.screenshot({
      path: path.join(projectRoot, 'tests/.artifacts/captures/folio/presentation-generated.png'),
    });
    const download = await a.waitForSelector('a[href$="/download"]', { visible: true });
    const url = await download.evaluate((n) => n.href);
    const response = await fetch(url);
    assert.equal(response.status, 200);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.subarray(0, 2).toString(), 'PK');
    await fs.writeFile(
      path.join(projectRoot, 'tests/.artifacts/presentation-browser-output.pptx'),
      bytes,
    );
    await click(a, '참고 자료', 'tab');
    await a.waitForSelector('.presentation-citations li');
    await click(a, '슬라이드 정보 패널 접기');
    await click(a, '슬라이드 정보 패널 펼치기');
    assert.equal(
      await a.$eval(
        '.presentation-inspector [role=tab][aria-selected="true"]',
        (n) => n.textContent,
      ),
      '참고 자료',
    );
    await a.screenshot({
      path: path.join(
        projectRoot,
        'tests/.artifacts/captures/folio/presentation-reference-panel.png',
      ),
    });

    await click(a, '원문 보기');
    await a.waitForSelector('.processing-dialog');
    await a.waitForSelector('.processing-block');
    await a.keyboard.press('Escape');
    await a.waitForSelector('.processing-dialog', { hidden: true });
    await click(a, '이 발표자료 새 버전 만들기');
    await click(a, '새 버전 만들기');
    await a.waitForFunction(
      (first) => {
        const link = document.querySelector('.presentation-run-status a[href$="/download"]');
        return link && link.href !== first;
      },
      { timeout: 90000 },
      url,
    );
    const revisions = await json(server.base, `/api/v1/projects/${project.id}/presentations`);
    assert.equal(revisions.length, 2);
    assert.equal(revisions[0].presentation_id, revisions[1].presentation_id);
    assert.equal(revisions[0].presentation_version, 2);
    assert.equal((await fetch(url)).status, 200, 'Earlier output remains available');
    await b.goto(route + '?step=generation', { waitUntil: 'networkidle0' });
    await b.waitForSelector('.presentation-output');
    for (const width of [390, 320]) {
      await b.setViewport({ width, height: 844 });
      if (!(await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth)))
        await b.screenshot({
          path: path.join(
            projectRoot,
            'tests/.artifacts/captures/folio/presentation-mobile-overflow.png',
          ),
        });
      assert.equal(
        await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
        JSON.stringify(
          await b.evaluate(() =>
            [...document.querySelectorAll('main *')]
              .filter(
                (n) =>
                  n.getBoundingClientRect().right > innerWidth + 1 &&
                  !n.closest('.studio-steps,.presentation-thumbnails'),
              )
              .map((n) => ({
                tag: n.tagName,
                class: n.className,
                width: n.getBoundingClientRect().width,
              }))
              .slice(0, 10),
          ),
        ),
      );
    }
    await b.setViewport({ width: 390, height: 844 });
    await b.$eval('.presentation-deck', (n) => n.scrollIntoView({ block: 'start' }));
    await b.screenshot({
      path: path.join(
        projectRoot,
        'tests/.artifacts/captures/folio/presentation-generated-phone.png',
      ),
    });
    const currentMarker = await b.$eval('.studio-stepper [aria-current="step"]', (n) => {
      const r = n.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    });
    assert.ok(
      currentMarker.left >= 0 &&
        currentMarker.right <= 390 &&
        currentMarker.top >= 0 &&
        currentMarker.bottom <= 844,
    );
    await click(b, '슬라이드 목록 접기');
    await click(b, '슬라이드 정보 패널 접기');
    assert.equal(await b.$eval('.presentation-slide-panel', (n) => n.hidden), true);
    await click(b, '슬라이드 목록 펼치기');
    await click(b, '슬라이드 정보 패널 펼치기');

    const calls = fixture.calls();
    await server.stop();
    await server.start();
    await b.reload({ waitUntil: 'networkidle0' });
    await b.waitForSelector('.presentation-output');
    assert.equal(fixture.calls(), calls);
    assert.deepEqual(errors, []);
    console.log(
      'PASS: source → guide → outline → evidence → template → editable PPTX, real previews, shared browsers, mobile and restart.',
    );
  } finally {
    if (session) await session.close();
    await server.close();
    await fixture.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
