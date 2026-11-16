// Purpose: Verify HTML upload/download in the real UI without executing document content.
// Pattern: Owned local fixtures and downloads; two shared views and restart persistence.
// Usage: Called by Space E2E with its isolated server and disposable fixture directory.
// Related: space.cjs, space-checks.cjs, backend/tests/space_support/html.rs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { upload, notifications, action } = require('./space-checks.cjs');
async function htmlChecks(a, b, server, fixtureRoot, captures) {
  const source = Buffer.from(
    '<!DOCTYPE html><html lang="ko"><meta charset="utf-8"><h1>팀 웹 문서</h1><script>window.puputyxHtmlExecuted=true</script><img src="https://html-fixture.invalid/tracker"></html>',
  );
  const filename = '팀 웹 문서.html';
  const original = path.join(fixtureRoot, filename);
  const replacement = path.join(fixtureRoot, '웹 문서 개정.htm');
  const second = Buffer.from('<article><h2>개정된 웹 문서</h2><p>원본 보존</article>');
  fs.writeFileSync(original, source);
  fs.writeFileSync(replacement, second);
  const external = [];
  const observe = (request) => {
    if (request.url().includes('html-fixture.invalid')) external.push(request.url());
  };
  a.on('request', observe);
  try {
    await a.setViewport({ width: 1440, height: 1000 });
    await a.goto(server.base + '/home/space?tab=references&q=' + encodeURIComponent('웹 문서'), {
      waitUntil: 'networkidle0',
    });
    await upload(a, [original], '팀 웹 문서');
    await a.waitForSelector('.space-asset');
    assert.match(await a.$eval('.space-asset', (n) => n.textContent), /HTML/);
    assert.equal(await a.evaluate(() => window.puputyxHtmlExecuted), undefined);
    assert.equal(await a.$('main iframe'), null);
    await b.goto(server.base + '/home/space?tab=references&q=' + encodeURIComponent('웹 문서'), {
      waitUntil: 'networkidle0',
    });
    await b.waitForSelector('.space-asset');
    await notifications(b);
    assert.equal(await b.$('.work-dock'), null);
    await notifications(b, false);
    const href = await a.$eval('.space-asset a', (n) => n.href);
    const response = await fetch(href);
    assert.equal(response.headers.get('content-type'), 'text/html');
    assert.match(response.headers.get('content-security-policy'), /sandbox/);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), source);
    const downloads = path.join(fixtureRoot, 'downloads');
    fs.mkdirSync(downloads);
    await a.browserContext().setDownloadBehavior({ policy: 'allow', downloadPath: downloads });
    const url = a.url();
    await a.click('.space-asset a');
    const saved = path.join(downloads, filename);
    for (let attempt = 0; attempt < 100 && !fs.existsSync(saved); attempt++) await delay(50);
    assert.deepEqual(fs.readFileSync(saved), source);
    assert.equal(a.url(), url);
    assert.equal(await a.evaluate(() => window.puputyxHtmlExecuted), undefined);
    await action(a, '새 파일 버전');
    const input = await a.$('.space-dialog input[type="file"]');
    assert.match(await input.evaluate((n) => n.accept), /\.html,\.htm/);
    await input.uploadFile(replacement);
    await a.click('.space-dialog button[type="submit"]');
    await a.waitForSelector('.space-dialog', { hidden: true });
    await a.waitForFunction(() =>
      document.querySelector('.space-asset')?.textContent.includes('v2'),
    );
    await a.screenshot({ path: path.join(captures, 'space-html-production.png'), fullPage: true });
    await server.stop();
    await server.start();
    await a.reload({ waitUntil: 'networkidle0' });
    await a.waitForSelector('.space-asset');
    assert.deepEqual(Buffer.from(await (await fetch(href + '?version=1')).arrayBuffer()), source);
    assert.deepEqual(Buffer.from(await (await fetch(href)).arrayBuffer()), second);
    assert.deepEqual(external, []);
    console.log(
      'PASS: HTML/HTM UI registration, shared list, download headers and browser attachment, exact original bytes, file replacement, restart and no script/resource execution.',
    );
  } finally {
    a.off('request', observe);
  }
}
module.exports = { htmlChecks };
