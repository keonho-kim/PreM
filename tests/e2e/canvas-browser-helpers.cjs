// Purpose: Own bounded browser waits, accessible canvas control input and screenshot output.
// Pattern: Semantic locators and native input filling; no application data or provider state.
// Usage: Canvas authoring's real-server journey.
// Related: canvas-authoring.cjs, tests/helpers/browser.cjs.
const assert = require('node:assert/strict');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { projectRoot } = require('../helpers/browser.cjs');
const { clickRole, settleLayout } = require('../helpers/interactions.cjs');
async function poll(read, done) {
  const end = Date.now() + 120000;
  while (Date.now() < end) {
    const value = await read();
    if (done(value)) return value;
    await delay(150);
  }
  throw Error('Canvas journey timed out');
}
async function click(page, name, role = 'button') {
  await clickRole(page, name, role);
}
async function fill(page, selector, value) {
  await page.locator(selector).fill(value);
  assert.equal(await page.$eval(selector, (n) => n.value), value);
}

async function capture(page, name) {
  await page.screenshot({ path: path.join(projectRoot, 'tests/.artifacts/captures/folio', name) });
}
async function resizeSelected(page, requests) {
  await settleLayout(page);
  const handles = await page.$$('.canvas-object-target.is-selected .canvas-resize-handle');
  const boxes = await Promise.all(
    handles.map(async (node) => ({ node, box: await node.boundingBox() })),
  );
  const chosen = boxes
    .filter((item) => item.box)
    .sort((a, b) => b.box.x + b.box.y - a.box.x - a.box.y)[0];
  assert(chosen, 'Selected object exposes resize handles');
  await chosen.node.evaluate((node) => node.scrollIntoView({ block: 'center', inline: 'nearest' }));
  await settleLayout(page);
  const corner = await chosen.node.boundingBox();
  const point = { x: corner.x + corner.width / 2, y: corner.y + corner.height / 2 };
  assert(
    await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.classList.contains('canvas-resize-handle'),
      point,
    ),
  );
  const before = requests.length;
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await settleLayout(page);
  await page.mouse.move(point.x + 40, point.y + 20, { steps: 8 });
  await settleLayout(page);
  await page.mouse.up();
  await poll(
    () => requests.length,
    (count) => count > before,
  );
  assert.equal(requests.length, before + 1, 'Resize commits exactly once on release');
}
module.exports = { poll, click, fill, capture, resizeSelected };
