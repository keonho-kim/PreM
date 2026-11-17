// Purpose: Synchronize real input and responsive assertions with browser layout work.
// Pattern: Puppeteer actionability checks plus frame boundaries, never synthetic DOM clicks.
// Usage: E2E suites use setViewport before geometry checks and clickRole for named controls.
// Related: browser.cjs, tests/e2e/mobile-work-panel.cjs, https://pptr.dev/guides/page-interactions.
async function settleLayout(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}
async function setViewport(page, viewport) {
  await page.setViewport(viewport);
  // ResizeObserver updates sticky offsets and reserved work-panel space after viewport emulation.
  await settleLayout(page);
}
async function clickRole(page, name, role = 'button') {
  const selector = `::-p-aria(${name}[role="${role}"])`;
  const target = await page.waitForSelector(selector, { visible: true });
  try {
    await target.evaluate((node) => node.scrollIntoView({ block: 'center', inline: 'nearest' }));
  } finally {
    await target.dispose();
  }
  await page.locator(selector).click();
  await settleLayout(page);
}
module.exports = { settleLayout, setViewport, clickRole };
