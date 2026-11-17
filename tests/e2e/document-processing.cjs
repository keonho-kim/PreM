// Purpose: Verify real Space extraction, model configuration, template-only intake and recovery UX.
// Pattern: Compiled app, actual bundled tools, local LLM fixture and two isolated browser contexts.
// Usage: pnpm test:e2e after runtime preparation and pnpm build; never seeds production storage.
// Related: server.cjs, space-checks.cjs, backend/tests/document_processing.rs.
const assert = require('node:assert/strict');
const { authorizedFetch: fetch } = require('./admin-client.cjs');
const http = require('node:http');
const { once } = require('node:events');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createServer } = require('./server.cjs');
const { upload, notifications } = require('./space-checks.cjs');
const { openBrowser, projectRoot } = require('../helpers/browser.cjs');
async function click(page, name, role = 'button') {
  await (await page.waitForSelector(`::-p-aria(${name}[role="${role}"])`)).click();
  if (role === 'tab')
    await page.waitForFunction(
      (name) =>
        Array.from(document.querySelectorAll('[role="tab"][aria-selected="true"]')).some(
          (e) => e.textContent.trim() === name,
        ),
      {},
      name,
    );
}
async function stage(page, text) {
  await page.waitForFunction(
    (text) =>
      document.querySelector('.processing-dialog .processing-status')?.textContent.includes(text),
    { timeout: 60000 },
    text,
  );
}
async function capture(page, name) {
  await page.evaluate(async () => {
    window.scrollTo(0, 0);
    document.querySelector('.asset-preview-body')?.scrollTo(0, 0);
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.screenshot({
    path: path.join(projectRoot, 'tests/.artifacts/captures/folio', name),
    fullPage: true,
  });
}
(async () => {
  let calls = 0,
    invalid = false;
  const model = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    const input = JSON.parse(body.messages[1].content);
    calls++;
    const answers = Object.fromEntries(
      Object.keys(input.questions).map((key) => [
        key,
        {
          type: 'choice',
          choice: /목차|Contents|\.\.\./.test(input.state.regions[key].text) ? '1' : '0',
        },
      ]),
    );
    res.end(
      JSON.stringify({
        choices: [
          {
            finish_reason: 'stop',
            message: { content: invalid ? 'invalid output' : JSON.stringify({ answers }) },
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 10 },
      }),
    );
  });
  model.listen(0, '127.0.0.1');
  await once(model, 'listening');
  const server = await createServer('document-browser-');
  let session;
  try {
    await server.start();
    const provider = randomUUID();
    const saved = await fetch(`${server.base}/api/v1/admin/llm/providers/${provider}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expected_version: 0,
        name: '문서 테스트',
        provider_type: 'lm_studio',
        base_url: `http://127.0.0.1:${model.address().port}/v1`,
        model_identifier: 'fixture',
        timeout_seconds: 30,
        enabled: true,
      }),
    });
    assert.equal(saved.status, 200);
    session = await openBrowser('document-processing');
    const a = await (await session.browser.createBrowserContext()).newPage();
    const b = await (await session.browser.createBrowserContext()).newPage();
    await a.bringToFront();
    await a.setViewport({ width: 1440, height: 1000 });
    const errors = [];
    a.on('pageerror', (e) => errors.push(e.message));
    await a.goto(server.base + '/home/space/library', { waitUntil: 'networkidle0' });
    await a.waitForSelector('.space-empty');
    const fixture = (name) => path.join(projectRoot, 'tests/fixtures/documents', name);
    await upload(a, [fixture('reference.html')], '프로젝트 가이드');
    await a.waitForSelector('.space-asset');
    await notifications(a, false);
    await click(a, '프로젝트 가이드 미리보기');
    await stage(a, '자료 준비가 잠시 대기 중입니다');
    assert.doesNotMatch(await a.$eval('.processing-dialog', (e) => e.textContent), /사업 개요/);
    assert.equal(await a.$('.processing-dialog script'), null);
    assert.equal(calls, 0);
    assert.equal(await a.$$eval('.processing-stages li', (nodes) => nodes.length), 3);
    assert((await a.$eval('.processing-stages', (n) => n.textContent)).includes('설정 대기'));
    await capture(a, 'document-engine-waiting.png');
    const beforeItem = (await (await fetch(server.base + '/api/v1/space/references')).json())
      .items[0];
    const processingPath = `${server.base}/api/v1/space/references/${beforeItem.id}/processing`;
    const extractedBefore = await (await fetch(processingPath)).json();
    await a.keyboard.press('Escape');
    await a.waitForSelector('.processing-dialog', { hidden: true });
    await notifications(a, true);
    await click(a, '자료 준비 취소');
    await a.waitForFunction(() =>
      document.querySelector('.upload-preparation')?.textContent.includes('취소됨'),
    );
    await click(a, '자료 준비 다시 시도');
    await a.waitForFunction(
      () => document.querySelector('.upload-preparation')?.textContent.includes('설정 대기'),
      { timeout: 60000 },
    );
    const extractedAfter = await (await fetch(processingPath)).json();
    assert.equal(extractedAfter.job.extraction_id, extractedBefore.job.extraction_id);
    assert.equal(extractedAfter.job.extraction_id, null);
    await capture(a, 'document-engine-panel.png');
    await a.setViewport({ width: 390, height: 844 });
    assert(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await capture(a, 'document-engine-panel-phone.png');
    await a.setViewport({ width: 1440, height: 1000 });
    await notifications(a, false);
    await click(a, '프로젝트 가이드 미리보기');
    await stage(a, '자료 준비가 잠시 대기 중입니다');
    assert.doesNotMatch(
      await a.$eval('.processing-dialog', (e) => e.textContent),
      /체크포인트|PPT Master|Config/,
    );
    await a.goto(server.base + '/home/admin?section=processing', { waitUntil: 'networkidle0' });
    await server.unlock(a);
    await a.waitForSelector('.processing-settings');
    await click(a, '사용할 판정 연결', 'combobox');
    await click(a, '문서 테스트 · LLM 판정', 'option');
    await click(a, '판정 연결 적용');
    await a.waitForFunction(() =>
      document
        .querySelector('.processing-settings [role="status"]')
        ?.textContent.includes('설정을 저장했습니다.'),
    );
    await a.click('.app-navigation a[href="/home/space"]');
    await a.waitForSelector('a[href="/home/space/library"]');
    await a.click('a[href="/home/space/library"]');
    await a.waitForSelector('.space-asset');
    await click(a, '프로젝트 가이드 미리보기');
    await stage(a, '자료 준비 완료');
    assert.equal(
      await a.$$eval(
        '.processing-stages li',
        (nodes) => nodes.filter((n) => n.textContent.includes('완료')).length,
      ),
      3,
    );
    await a.type('#block-search', '예산');
    await click(a, '검색');
    await a.waitForFunction(
      () =>
        document.querySelector('.processing-blocks')?.textContent.includes('예산') &&
        document.querySelectorAll('.processing-block').length === 1,
    );
    await capture(a, 'space-reference-processing.png');
    await a.keyboard.press('Escape');
    await a.waitForSelector('.processing-dialog', { hidden: true });
    await b.goto(server.base + '/home/space/library', { waitUntil: 'networkidle0' });
    await b.waitForSelector('.space-asset');
    assert.equal(await b.$('.work-dock'), null);
    await a.bringToFront();
    await upload(a, [fixture('text.pdf')], '사업 개요');
    await a.waitForFunction(() => document.querySelectorAll('.space-asset').length === 2);
    await notifications(a, false);
    await click(a, '사업 개요 미리보기');
    await stage(a, '자료 준비 완료');
    await click(a, '원본 페이지', 'tab');
    await a.waitForSelector('.processing-pages img');
    assert.equal(
      await a.$$eval('.processing-pages img', (nodes) => nodes.every((n) => n.loading === 'lazy')),
      true,
    );
    await capture(a, 'space-document-pages.png');
    await a.setViewport({ width: 390, height: 844 });
    assert.equal(await a.$eval('.processing-dialog', (e) => e.scrollWidth <= e.clientWidth), true);
    await capture(a, 'space-document-pages-phone.png');
    await a.keyboard.press('Escape');
    await a.waitForSelector('.processing-dialog', { hidden: true });
    await a.setViewport({ width: 1440, height: 1000 });
    const prior = calls;
    await click(a, '템플릿', 'tab');
    await upload(a, [fixture('native-template.pptx')], '회사 소개 템플릿');
    await a.waitForSelector('.space-asset');
    await notifications(a, false);
    await click(a, '회사 소개 템플릿 미리보기');
    await stage(a, '템플릿 준비 완료');
    assert.equal(await a.$$eval('.processing-stages li', (nodes) => nodes.length), 2);
    assert(!(await a.$eval('.processing-stages', (n) => n.textContent)).includes('내용 정리'));
    await a.waitForFunction(() => {
      const img = document.querySelector('.template-preview-paper img');
      return img?.complete && img.naturalWidth > 0;
    });
    assert.equal(await a.$$eval('.template-thumbnail', (nodes) => nodes.length), 2);
    assert.doesNotMatch(
      await a.$eval('.processing-dialog', (e) => e.textContent),
      /PPT Master|네이티브|체크포인트|판정|번들|마스터|슬롯/,
    );
    await click(a, '다음 슬라이드');
    await a.waitForSelector('img[alt="슬라이드 2 미리보기"]');
    await a.waitForFunction(
      () => document.querySelector('.template-preview-paper img')?.naturalWidth > 0,
    );
    await click(a, '슬라이드 1 보기');
    assert.equal(await a.$('.processing-blocks'), null);
    assert.equal(calls, prior);
    await capture(a, 'space-template-analysis.png');
    await a.setViewport({ width: 390, height: 844 });
    assert.equal(await a.$eval('.processing-dialog', (e) => e.scrollWidth <= e.clientWidth), true);
    await capture(a, 'space-template-preview-phone.png');
    await a.setViewport({ width: 1440, height: 1000 });
    await a.keyboard.press('Escape');
    await a.waitForSelector('.processing-dialog', { hidden: true });
    await click(a, '레퍼런스', 'tab');
    await click(a, '프로젝트 가이드 미리보기');
    await stage(a, '자료 준비 완료');
    invalid = true;
    const listing = await (await fetch(server.base + '/api/v1/space/references')).json();
    const target = listing.items.find((item) => item.title === '프로젝트 가이드');
    assert.ok(target);
    const rerun = await fetch(`${server.base}/api/v1/space/references/${target.id}/processing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({ expected_version: target.version }),
    });
    assert.equal(rerun.status, 202);
    await a.keyboard.press('Escape');
    await a.waitForSelector('.processing-dialog', { hidden: true });
    await click(a, '프로젝트 가이드 미리보기');
    await stage(a, '자료를 준비하지 못했습니다');
    invalid = false;
    await click(a, '다시 시도');
    await stage(a, '자료 준비 완료');
    const before = calls;
    await a.keyboard.press('Escape');
    await server.stop();
    await server.start();
    await b.reload({ waitUntil: 'networkidle0' });
    await b.waitForSelector('.space-asset');
    await b.bringToFront();
    await click(b, '프로젝트 가이드 미리보기');
    await stage(b, '자료 준비 완료');
    assert.equal(calls, before);
    assert.deepEqual(errors, []);
    console.log(
      'Document browser passed: upload, waiting configuration, explicit LLM selection, content search, lazy PDF gallery, template-only extraction, retry, shared results, tab-local progress, mobile and restart',
    );
  } finally {
    if (session) await session.close();
    await server.close();
    model.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
