// Purpose: Own bounded browser waits, accessible canvas control input and screenshot output.
// Pattern: Semantic locators and native input filling; no application data or provider state.
// Usage: Canvas authoring's real-server journey.
// Related: canvas-authoring.cjs, tests/helpers/browser.cjs.
const assert = require('node:assert/strict');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { projectRoot } = require('../helpers/browser.cjs');
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
  const n = await page.waitForSelector(`::-p-aria(${name}[role="${role}"])`, { visible: true });
  await n.evaluate((n) => n.scrollIntoView({ block: 'center' }));
  await n.click();
}
async function fill(page, selector, value) {
  await page.locator(selector).fill(value);
  assert.equal(await page.$eval(selector, (n) => n.value), value);
}

async function capture(page, name) {
  await page.screenshot({ path: path.join(projectRoot, 'tests/.artifacts/captures/folio', name) });
}
module.exports = { poll, click, fill, capture };
