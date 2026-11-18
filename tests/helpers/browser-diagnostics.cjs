// Purpose: Preserve synthetic browser geometry when remote CI differs from local execution.
// Pattern: Closing snapshots omit field contents and stay within disposable QA artifacts.
// Usage: browser.cjs invokes before closing CI sessions; failures never block browser cleanup.
// Related: browser.cjs, tests/.artifacts/captures/ci/.
const fs = require('node:fs/promises');
const path = require('node:path');
async function captureBrowser(browser, name, artifacts) {
  const folder = path.join(artifacts, 'captures/ci');
  await fs.mkdir(folder, { recursive: true });
  for (const [index, page] of (await browser.pages()).entries()) {
    try {
      const geometry = await page.evaluate(() => ({
        route: location.pathname,
        viewport: { width: innerWidth, height: innerHeight },
        scrollWidth: document.documentElement.scrollWidth,
        overflow: [...document.querySelectorAll('body *')]
          .filter((node) => node.getBoundingClientRect().right > innerWidth + 1)
          .slice(0, 20)
          .map((node) => ({
            tag: node.tagName,
            class: node.getAttribute('class'),
            rect: node.getBoundingClientRect().toJSON(),
          })),
      }));
      const prefix = path.join(folder, `${name.replace(/[^a-z0-9-]/gi, '-')}-${index}`);
      await fs.writeFile(prefix + '.json', JSON.stringify(geometry, null, 2));
      // Only QA input fields are hidden; no real application data is used by these suites.
      await page.addStyleTag({ content: 'input, textarea { visibility: hidden !important; }' });
      await page.screenshot({ path: prefix + '.png' });
    } catch (error) {
      console.warn('Browser closing snapshot unavailable:', error.name);
    }
  }
}
module.exports = { captureBrowser };
