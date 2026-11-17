// Purpose: Verify actual pointer/keyboard hold comparison at the central slide controls.
// Pattern: Real browser input and preloaded native previews; every release returns to current output.
// Usage: slide-chat.cjs invokes before and after committing its proposal.
// Related: comparison-button.tsx, canvas-toolbar.tsx, tests/.artifacts/captures/folio/.
const assert = require('node:assert/strict');
const path = require('node:path');
const { projectRoot } = require('../helpers/browser.cjs');
async function state(page, kind) {
  await page.waitForFunction(
    (kind) => {
      const n = document.querySelector('.presentation-output');
      return n?.dataset.preview === kind && n.complete && n.naturalWidth > 0;
    },
    {},
    kind,
  );
}
async function compare(page, kind, capture) {
  const b = await page.waitForSelector(
    'button[aria-label="누르고 이전 장표 보기"]:not(:disabled)',
    { visible: true },
  );
  await b.evaluate((n) => n.scrollIntoView({ block: 'center' }));
  const rect = await b.boundingBox();
  const undo = await page.$eval(
    'button[aria-label="이전 상태로 되돌리기"]',
    (n) => n.getBoundingClientRect().x,
  );
  const zoom = await page.$eval(
    'button[aria-label="슬라이드 축소"]',
    (n) => n.getBoundingClientRect().x,
  );
  assert(rect.x < undo && undo < zoom);
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await state(page, 'before');
  if (capture)
    await page.screenshot({
      path: path.join(projectRoot, `tests/.artifacts/captures/folio/${capture}.png`),
    });
  await page.mouse.move(rect.x - 80, rect.y + 60);
  await state(page, 'before');
  await page.mouse.up();
  await state(page, kind);
  await b.focus();
  await page.keyboard.down('Space');
  await state(page, 'before');
  await page.keyboard.up('Space');
  await state(page, kind);
  await page.keyboard.down('Space');
  await state(page, 'before');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await state(page, kind);
  await page.keyboard.up('Space');
  assert.equal(await page.$('.slide-chat button[title="수정 전후 보기"]'), null);
  const chatButtons = await page.$$eval('.slide-chat button', (nodes) =>
    nodes.map((n) => n.textContent),
  );
  assert(!chatButtons.includes('수정 전후 보기') && !chatButtons.includes('수정 결과 보기'));
}
module.exports = { compare, state };
async function touchCompare(page, kind) {
  const b = await page.waitForSelector(
    'button[aria-label="누르고 이전 장표 보기"]:not(:disabled)',
    { visible: true },
  );
  await b.evaluate((n) => n.scrollIntoView({ block: 'center' }));
  const r = await b.boundingBox();
  const client = await page.createCDPSession();
  const point = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  try {
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await state(page, 'before');
    await new Promise((resolve) => setTimeout(resolve, 650));
    await state(page, 'before');
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await state(page, kind);
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await state(page, 'before');
    await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await state(page, kind);
  } finally {
    await client.detach();
  }
}
module.exports.touchCompare = touchCompare;
