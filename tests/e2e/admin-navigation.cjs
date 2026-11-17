// Purpose: Verify Admin-specific navigation, tab state and disclosure in the real browser.
// Pattern: User keyboard/pointer actions and URL restoration on a real provider connection.
// Usage: Called by the provider E2E journey after a successful test response.
// Related: providers.cjs, pages/admin-page.tsx, features/providers/provider-panels.tsx.
const assert = require('node:assert/strict');
async function adminNavigation(page, providerId, unlock) {
  const tab = async (name) =>
    await (await page.waitForSelector(`::-p-aria(${name}[role="tab"])`)).click();
  assert.equal(await page.$$eval('main', (nodes) => nodes.length), 1);
  await tab('요청 이력');
  await page.waitForSelector('[role="tabpanel"][data-state="active"] .provider-history tbody tr');
  assert.equal(new URL(page.url()).searchParams.get('tab'), 'history');
  assert.equal(new URL(page.url()).searchParams.get('provider'), providerId);
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('#admin-token');
  await unlock(page);
  await page.waitForSelector('.provider-tabs');
  assert.equal(
    await page.$eval('.provider-tabs [role="tab"][aria-selected="true"]', (n) => n.textContent),
    '요청 이력',
  );
  const selected = await page.$('.provider-tabs [role="tab"][aria-selected="true"]');
  await selected.focus();
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(() => document.activeElement?.textContent === '연결 테스트');
  assert.equal(new URL(page.url()).searchParams.get('tab'), 'history');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => new URL(location.href).searchParams.get('tab') === 'tests');
  await page.goBack();
  await page.waitForFunction(() => new URL(location.href).searchParams.get('tab') === 'history');
  await page.click('.admin-sidebar a[href*="section=general"]');
  await page.waitForSelector('.admin-general');
  assert.equal(await page.$eval('main h1', (n) => n.textContent), '일반 설정');
  assert.equal(
    await page.$eval('.admin-sidebar [aria-current="page"]', (n) => n.textContent),
    '일반',
  );
  assert.equal(
    await page.evaluate(() => document.activeElement === document.querySelector('main h1')),
    true,
  );
  await page.goBack();
  await page.waitForSelector('.provider-tabs');
  assert.equal(
    await page.$eval('.provider-tabs [role="tab"][aria-selected="true"]', (n) => n.textContent),
    '요청 이력',
  );
  await page.click('button[aria-label="Admin 메뉴 접기"]');
  await page.waitForSelector('.admin-layout-collapsed');
  assert.equal(
    await page.$eval('button[aria-label="Admin 메뉴 펼치기"]', (n) =>
      n.getAttribute('aria-expanded'),
    ),
    'false',
  );
  await page.click('button[aria-label="Admin 메뉴 펼치기"]');
  await page.setViewport({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.click('button[aria-label="Admin 메뉴 접기"]');
  await page.click('button[aria-label="Admin 메뉴 펼치기"]');
  await page.setViewport({ width: 1440, height: 1000 });
  await tab('연결 설정');
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
}
module.exports = { adminNavigation };
