// Purpose: Keep internal development language and QA controls out of office-worker mock journeys.
// Pattern: Rendered text and accessible names across routes, dialogs and actual action states.
// Usage: node mock/helpers/office-language.cjs against the static mock server on 5174.
// Related: screens.cjs, blueprint/07-ui-design.md, mock/js/views/.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { openBrowser, projectRoot, artifacts, baseURL } = require('./browser.cjs');
const screens = require('./screens.cjs');
const forbidden =
  /\b(?:LLM|Provider|Workflow|JSON|Checkpoint|Blob|schema_version)\b|리비전|콘텐츠 블록|매핑|라우팅|검색 색인|체크포인트|슬롯 검증|브라우저 메모리|원문을 목차에 복사/iu;
(async () => {
  const session = await openBrowser('office-language');
  const page = await session.browser.newPage();
  const errors = [],
    checked = [];
  page.on('pageerror', (e) => errors.push(e.message));
  async function audit(label) {
    const content = await page.evaluate(() => ({
      text: document.body.innerText,
      labels: [...document.querySelectorAll('[aria-label], [title]')]
        .filter((n) => n.getClientRects().length)
        .map((n) => `${n.getAttribute('aria-label') ?? ''} ${n.getAttribute('title') ?? ''}`)
        .join('\n'),
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
    }));
    assert.doesNotMatch(content.text + '\n' + content.labels, forbidden, label);
    assert.equal(content.overflow, false, label);
    assert.equal(await page.$('.state-demo'), null);
    checked.push(label);
  }
  async function route(hash) {
    await page.goto(new URL(hash, baseURL).href, { waitUntil: 'networkidle0' });
  }
  async function modal(action, label) {
    await page.click(`[data-action="${action}"]`);
    await page.waitForSelector('#app-dialog[open]');
    await audit(label);
    await page.keyboard.press('Escape');
  }
  try {
    for (const width of [1440, 390]) {
      await page.setViewport({ width, height: width === 390 ? 844 : 1000 });
      for (const screen of screens) {
        await route(screen.hash);
        await audit(`${width}: ${screen.title}`);
      }
    }
    await page.setViewport({ width: 1440, height: 1000 });
    await route('#view=projects');
    await modal('new-project', '프로젝트 만들기');
    await modal('help', '사용 안내');
    await modal('account-preview', '샘플 설정');
    await route('#view=outline&project=platform');
    await modal('map-block', '목차에 내용 담기');
    await route('#view=editor&project=platform&deck=deck1');
    await modal('deck-revisions', '이전 내용');
    await modal('export', '체험 내용 보관');
    await route('#view=presentations&project=platform');
    await page.click('[data-action="generate"]');
    await audit('PPT 만들기 입력');
    await page.click('[data-form="generate"] button[type="submit"]');
    await page.waitForSelector('[data-run-panel]');
    assert.equal(
      await page.$('.workflow-steps'),
      null,
      'Internal execution stages are not user progress',
    );
    await page.click('[data-action="toggle-run"]');
    await audit('일시 정지');
    await page.click('[data-action="toggle-run"]');
    await page.waitForFunction(() =>
      document.querySelector('[data-run-status]')?.textContent.includes('완료'),
    );
    await audit('완료 안내');
    await route('#view=admin&tab=providers');
    await page.click('[data-action="new-provider"]');
    assert.equal(await page.$eval('.office-connection-details', (n) => n.open), false);
    await page.click('.office-connection-details summary');
    await audit('세부 연결 정보');
    await page.keyboard.press('Escape');
    await page.goto(
      pathToFileURL(projectRoot + '/mock/index.html').href + '#view=guide&project=platform',
      { waitUntil: 'networkidle0' },
    );
    await audit('직접 파일 열기');
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(artifacts, 'office-language-report.json'),
      JSON.stringify({ checked, errors }, null, 2),
    );
    console.log(
      `PASS: ${checked.length} office-language checks; no developer terminology, hidden QA controls or horizontal overflow.`,
    );
  } finally {
    await session.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
