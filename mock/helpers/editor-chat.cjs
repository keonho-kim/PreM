// Purpose: Verify chat scope, multi-selection and immutable application in a browser.
// Pattern: Actual input journeys plus observable exported state assertions.
// Usage: node mock/helpers/editor-chat.cjs with PREM_BROWSER_TOOLS.
// Related: editor-chat.js, editor-selection.js, chat-patch.js.
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { openBrowser, baseURL, projectRoot } = require('./browser.cjs');
(async () => {
  const { browser, close } = await openBrowser('editor-chat');
  try {
    const p = await browser.newPage(),
      errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    await p.setViewport({ width: 1440, height: 1000 });
    await p.goto(baseURL + '#view=editor&project=platform&deck=deck1', {
      waitUntil: 'networkidle0',
    });
    const state = () => p.evaluate(() => PreMMock.snapshot().projects[0].decks[0]);
    const select = async (field, mod) => {
      if (mod) await p.keyboard.down(mod);
      await p.click('.editor-stage [data-edit-field="' + field + '"]');
      if (mod) await p.keyboard.up(mod);
    };
    const send = async (text) => {
      await p.type('#edit-instruction', text);
      await p.keyboard.press('Enter');
    };
    const before = await state();
    await select('title');
    await select('0', 'Control');
    assert.equal(await p.$$eval('.editor-stage .component-selected', (n) => n.length), 2);
    assert.match(await p.$eval('#chat-target-label', (n) => n.textContent), /2개 요소/);
    await select('0', 'Meta');
    assert.equal(await p.$$eval('.editor-stage .component-selected', (n) => n.length), 1);
    await select('0', 'Control');
    await send('“함께 수정한 문구”로 바꿔줘');
    assert.equal(await p.$('dialog[open]'), null);
    assert.deepEqual((await state()).slides, before.slides);
    await select('0'); // Applying must still use the original selected title + body 0.
    await p.click('[data-chat-apply]');
    const after = await state();
    assert.equal(after.slides[0].title, '함께 수정한 문구');
    assert.equal(after.slides[0].body[0], '함께 수정한 문구');
    assert.equal(after.slides[0].body[1], before.slides[0].body[1]);
    assert.deepEqual(after.slides.slice(1), before.slides.slice(1));
    assert.deepEqual(after.revisions[0].slides, before.slides);
    await select('0');
    await send('“오래된 수정안”으로 바꿔줘');
    await p.click('[data-canvas-command="shape"]');
    const edited = await state();
    await p.click('[data-chat-apply]');
    assert.deepEqual(await state(), edited);
    assert.match(await p.$eval('#chat-messages', (n) => n.textContent), /변경되어 적용할 수 없/);
    await p.click('.editor-stage [data-object-id]');
    await send('오른쪽으로 이동');
    await p.click('[data-chat-apply]');
    assert.equal((await state()).slides[0].objects[0].x, edited.slides[0].objects[0].x + 20);
    assert.equal((await state()).slides[0].title, edited.slides[0].title);
    await p.type('#edit-instruction', '한글 조합');
    const count = await p.$$eval('.chat-message.user', (n) => n.length);
    for (const options of [{ isComposing: true }, { keyCode: 229 }]) {
      await p.$eval(
        '#edit-instruction',
        (n, opts) =>
          n.dispatchEvent(
            new KeyboardEvent('keydown', {
              key: 'Enter',
              bubbles: true,
              cancelable: true,
              ...opts,
            }),
          ),
        options,
      );
    }
    assert.equal(await p.$$eval('.chat-message.user', (n) => n.length), count);
    await p.keyboard.down('Shift');
    await p.keyboard.press('Enter');
    await p.keyboard.up('Shift');
    assert.match(await p.$eval('#edit-instruction', (n) => n.value), /\n/);
    await p.click('#editor-references-tab');
    await p.click('#editor-chat-tab');
    assert.match(await p.$eval('#edit-instruction', (n) => n.value), /한글 조합/);
    await p.click('[data-action="slide-next"]');
    assert.equal(await p.$eval('#edit-instruction', (n) => n.value), '');
    assert.equal(await p.$eval('#chat-target-label', (n) => n.textContent), '현재 슬라이드');
    await p.click('[data-action="slide-prev"]');
    assert.match(await p.$eval('#edit-instruction', (n) => n.value), /한글 조합/);
    await p.screenshot({
      path: projectRoot + '/mock/captures/folio/editor-chat-desktop.png',
      fullPage: true,
    });
    for (const width of [1024, 768, 390, 320]) {
      await p.setViewport({ width, height: 900 });
      assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      if (width === 390)
        await p.screenshot({
          path: projectRoot + '/mock/captures/folio/editor-chat-phone.png',
          fullPage: true,
        });
    }
    await p.goto(
      pathToFileURL(projectRoot + '/mock/index.html').href +
        '#view=editor&project=platform&deck=deck1',
      { waitUntil: 'networkidle0' },
    );
    await select('title');
    await send('“파일 열기 확인”으로');
    await p.click('[data-chat-apply]');
    assert.equal((await state()).slides[0].title, '파일 열기 확인');
    await p.setViewport({ width: 1440, height: 1000 });
    await p.goto(baseURL + '#view=editor&project=platform&deck=deck1', {
      waitUntil: 'networkidle0',
    });
    await select('title');
    await select('0', 'Control');
    await send('“근거로 완성하는 프레젠테이션”으로 바꿔줘');
    await p.screenshot({
      path: projectRoot + '/mock/captures/folio/editor-chat-desktop.png',
      fullPage: true,
    });
    await p.setViewport({ width: 390, height: 900 });
    await p.screenshot({
      path: projectRoot + '/mock/captures/folio/editor-chat-phone.png',
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    console.log(
      'PASS: Ctrl/Meta multi-selection, pinned component scope, unchanged siblings/history, stale guard, shape geometry, IME, draft isolation, responsive layout, file opening',
    );
  } finally {
    await close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
