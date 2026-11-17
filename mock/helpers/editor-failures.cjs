// Purpose: Verify cancellation and invalid-input paths of direct slide editing.
// Pattern: Isolated browser journeys; no production data or network mutation.
// Usage: node mock/helpers/editor-failures.cjs.
// Related: mock/helpers/editor-basics.cjs, mock/js/canvas-editor.js.
const { openBrowser, baseURL, artifacts } = require('./browser.cjs');
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
(async () => {
  const { browser, close } = await openBrowser('editor-failures');
  const file = path.join(artifacts, 'invalid-image.txt');
  fs.writeFileSync(file, 'not an image');
  try {
    const p = await browser.newPage();
    await p.setViewport({ width: 1440, height: 1000 });
    await p.goto(baseURL + '#view=editor&project=platform&deck=deck1', {
      waitUntil: 'networkidle0',
    });
    const state = () => p.evaluate(() => PreMMock.snapshot().projects[0].decks[0]);
    const original = await state();
    await p.click('.editor-stage [data-edit-field="title"]');
    await p.keyboard.type('cancel this');
    await p.keyboard.press('Escape');
    assert.equal((await state()).version, original.version);
    await (await p.$('#canvas-image-file')).uploadFile(file);
    assert.equal((await state()).version, original.version);
    assert.match(await p.$eval('#canvas-message', (n) => n.textContent), /PNG/);
    await p.hover('[data-slide-index="0"]');
    const r = await p.$eval('[data-slide-drag="0"]', (n) => {
      const r = n.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await p.mouse.move(r.x, r.y);
    await p.mouse.down();
    await p.mouse.move(r.x, r.y + 180, { steps: 10 });
    await p.keyboard.press('Escape');
    await p.mouse.up();
    assert.deepEqual(
      (await state()).slides.map((s) => s.id),
      original.slides.map((s) => s.id),
    );
    await p.click('[data-action="add-slide"]');
    await p.click('[data-canvas-command="undo"]');
    assert.equal(await p.$eval('[data-canvas-command="redo"]', (n) => n.disabled), false);
    await p.click('[data-canvas-command="shape"]');
    assert.equal(await p.$eval('[data-canvas-command="redo"]', (n) => n.disabled), true);
    await p.click('[data-canvas-command="image"]');
    await p.keyboard.press('Escape');
    await p.click('.editor-stage [data-edit-field="title"]');
    await p.keyboard.type(' retained');
    await p.click('.slide-thumb[data-index="1"]');
    assert.ok((await state()).slides[0].title.includes('retained'));
    assert.equal(
      await p.$eval('.slide-thumb[data-index="1"]', (n) => n.getAttribute('aria-pressed')),
      'true',
    );
    const report = {
      textEscape: true,
      invalidImageRejected: true,
      dragEscape: true,
      redoBranchCleared: true,
    };
    fs.writeFileSync(
      path.join(artifacts, 'editor-failures-report.json'),
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report));
  } finally {
    await close();
    fs.rmSync(file, { force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
