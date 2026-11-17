// Purpose: Exercise slide menus, insertion, reorder and direct canvas editing.
// Pattern: Real pointer/keyboard journeys with temporary local image fixtures.
// Usage: node mock/helpers/editor-basics.cjs with the shared browser tool path.
// Related: mock/js/slide-list.js, mock/js/canvas-editor.js, mock/js/slide-commands.js.
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
const { openBrowser, baseURL, projectRoot, artifacts } = require('./browser.cjs');
(async () => {
  const { browser, close } = await openBrowser('editor-basics');
  const fixture = path.join(artifacts, 'editor-image.png');
  try {
    const p = await browser.newPage(),
      errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    await p.setViewport({ width: 1440, height: 1000 });
    await p.goto(baseURL + '#view=editor&project=platform&deck=deck1', {
      waitUntil: 'networkidle0',
    });
    const state = () => p.evaluate(() => PreMMock.snapshot().projects[0].decks[0]);
    const count = async (n) =>
      p.waitForFunction((n) => PreMMock.snapshot().projects[0].decks[0].slides.length === n, {}, n);
    await p.click('[data-action="add-slide"]');
    await count(7);
    await p.click('[data-canvas-command="undo"]');
    await count(6);
    await p.click('[data-canvas-command="redo"]');
    await count(7);
    await p.click('.slide-thumb[data-index="0"]', { button: 'right' });
    await p.waitForSelector('.slide-context-menu:popover-open');
    await p.click('[data-menu-cmd="duplicate"]');
    await count(8);
    assert.equal((await state()).slides[0].title, (await state()).slides[1].title);
    assert.notEqual((await state()).slides[0].id, (await state()).slides[1].id);
    await p.focus('[data-slide-menu="1"]');
    await p.keyboard.press('Enter');
    await p.keyboard.press('Escape');
    assert.equal(await p.$eval('[data-slide-menu="1"]', (n) => n === document.activeElement), true);
    await p.click('.slide-thumb[data-index="1"]', { button: 'right' });
    await p.click('[data-menu-cmd="delete"]');
    await count(7);
    const first = (await state()).slides[0].id;
    await p.$eval('[data-slide-drag="0"]', (n) => n.scrollIntoView({ block: 'center' }));
    const handle = await p.$eval('[data-slide-drag="0"]', (n) => {
      const r = n.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    const dest = await p.$eval('[data-slide-index="2"]', (n) => {
      const r = n.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.bottom + 3 };
    });
    await p.mouse.move(handle.x, handle.y);
    await p.mouse.down();
    await p.mouse.move(dest.x, dest.y, { steps: 12 });
    assert.equal(
      await p.$eval('#editor-slides .slide-rail', (n) => n.hasAttribute('data-drop')),
      true,
    );
    await p.mouse.up();
    assert.equal((await state()).slides[2].id, first);
    await p.focus('[data-slide-drag="2"]');
    await p.keyboard.down('Alt');
    await p.keyboard.press('ArrowUp');
    await p.keyboard.up('Alt');
    assert.equal((await state()).slides[1].id, first);
    const gap = await p.evaluate(() => {
      const a = document.querySelector('[data-slide-index="0"]').getBoundingClientRect(),
        b = document.querySelector('[data-slide-index="1"]').getBoundingClientRect();
      return { x: a.left + 15, y: (a.bottom + b.top) / 2 };
    });
    await p.mouse.move(gap.x, gap.y);
    await p.mouse.click(gap.x, gap.y, { button: 'right' });
    await p.click('[data-menu-cmd="insert"]');
    await count(8);
    const title = '.editor-stage [data-edit-field="title"]';
    await p.click(title);
    await p.evaluate(() => {
      const n = document.querySelector('.editor-stage [data-edit-field="title"]'),
        r = document.createRange();
      r.selectNodeContents(n);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
    });
    await p.keyboard.type('Direct edit');
    await p.keyboard.down('Control');
    await p.keyboard.press('Enter');
    await p.keyboard.up('Control');
    assert.ok((await state()).slides.some((s) => s.title === 'Direct edit'));
    await p.click('[data-canvas-command="text"]');
    let d = await state(),
      object = d.slides.find((s) => s.title === 'Direct edit').objects[0];
    assert.equal(object.type, 'text');
    const text = '.editor-stage [data-object-text]';
    await p.click(text);
    await p.evaluate(() => {
      const n = document.querySelector('.editor-stage [data-object-text]'),
        r = document.createRange();
      r.selectNodeContents(n);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
    });
    await p.keyboard.type('Movable text');
    await p.click('[data-canvas-command="bold"]');
    object = (await state()).slides.find((s) => s.title === 'Direct edit').objects[0];
    assert.equal(object.text, 'Movable text');
    assert.equal(object.bold, true);
    const data = await p.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 256;
      c.height = 128;
      const x = c.getContext('2d');
      x.fillStyle = '#208070';
      x.fillRect(0, 0, 256, 128);
      return c.toDataURL('image/png').split(',')[1];
    });
    fs.writeFileSync(fixture, Buffer.from(data, 'base64'));
    const [chooser] = await Promise.all([
      p.waitForFileChooser(),
      p.click('[data-canvas-command="image"]'),
    ]);
    await chooser.accept([fixture]);
    await p.waitForFunction(() =>
      PreMMock.snapshot().projects[0].decks[0].slides.some((s) =>
        s.objects?.some((o) => o.type === 'image'),
      ),
    );
    const imageSelector = '.editor-stage .slide-object:has(img)';
    const before = await p.$eval(imageSelector, (n) => ({
      id: n.dataset.objectId,
      x: parseFloat(n.style.left),
      y: parseFloat(n.style.top),
      w: parseFloat(n.style.width),
    }));
    const box = await p.$eval(imageSelector, (n) => {
      const r = n.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await p.mouse.move(box.x, box.y);
    await p.mouse.down();
    await p.mouse.move(box.x + 60, box.y + 30, { steps: 10 });
    await p.mouse.up();
    assert.ok((await p.$eval(imageSelector, (n) => parseFloat(n.style.left))) > before.x);
    const resize = await p.$eval(imageSelector + ' [data-object-resize]', (n) => {
      const r = n.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await p.mouse.move(resize.x, resize.y);
    await p.mouse.down();
    await p.mouse.move(resize.x + 40, resize.y + 20, { steps: 8 });
    await p.mouse.up();
    assert.ok((await p.$eval(imageSelector, (n) => parseFloat(n.style.width))) > before.w);
    await p.click('[data-canvas-command="delete"]');
    assert.equal(await p.$(imageSelector), null);
    await p.click('[data-canvas-command="undo"]');
    assert.ok(await p.$(imageSelector));
    await p.click('[data-canvas-command="shape"]');
    assert.ok(await p.$('.editor-stage .canvas-shape'));
    await p.click('[data-canvas-command="zoom-in"]');
    assert.equal(await p.$eval('#canvas-zoom-value', (n) => n.textContent), '125%');
    await p.click('[data-canvas-command="zoom-fit"]');
    await p.screenshot({
      path: projectRoot + '/mock/captures/folio/editor-basics-desktop.png',
      fullPage: true,
    });
    for (const width of [1024, 768, 390, 320]) {
      await p.setViewport({ width, height: 844 });
      assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    }
    await p.screenshot({
      path: projectRoot + '/mock/captures/folio/editor-basics-phone.png',
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    const result = {
      menus: true,
      gapInsertion: true,
      pointerReorder: true,
      keyboardReorder: true,
      undoRedo: true,
      directText: true,
      textBoxFormatting: true,
      localImage: true,
      imageMoveResizeDelete: true,
      shapes: true,
      zoom: true,
      responsive: true,
      errors,
    };
    fs.writeFileSync(
      path.join(artifacts, 'editor-basics-report.json'),
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result));
  } finally {
    await close();
    fs.rmSync(fixture, { force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
