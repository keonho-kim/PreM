// Purpose: Supply original-document fixtures and reusable Space browser operations.
// Pattern: Real files in disposable QA storage; interact through visible application controls.
// Usage: space.cjs owns server/browser lifetime and passes its fixture directory.
// Related: space.cjs, backend/tests/space_support/, tests/helpers/browser.cjs.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
function fixtures(root) {
  fs.mkdirSync(root, { recursive: true });
  execFileSync('python3', [
    '-c',
    `
import sys, zipfile
from pathlib import Path
root = Path(sys.argv[1])
for name, ext, part, typ in [('사내 소개','pptx','ppt/presentation.xml','presentationml.presentation'), ('팀 운영','docx','word/document.xml','wordprocessingml.document'), ('개정 운영','docx','word/document.xml','wordprocessingml.document')]:
    with zipfile.ZipFile(root / (name+'.'+ext), 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/'+part+'" ContentType="application/vnd.openxmlformats-officedocument.'+typ+'.main+xml"/></Types>')
        z.writestr('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>')
        z.writestr(part, '<document>'+name+'</document>')
(root / '손상 문서.pdf').write_bytes(b'not a PDF')
`,
    root,
  ]);
  return (name) => path.join(root, name);
}
async function button(page, selector, text) {
  await page.$$eval(
    selector,
    (nodes, text) => {
      const node = nodes.find((n) => n.textContent.trim() === text);
      if (!node) throw new Error('Missing button: ' + text);
      node.click();
    },
    text,
  );
}
async function action(page, text) {
  await page.click('.space-asset button[title="자료 메뉴"]');
  await page.waitForSelector('[role="menuitem"]');
  await button(page, '[role="menuitem"]', text);
  await page.waitForSelector('.space-dialog');
}
async function notifications(page, open = true) {
  if (!(await page.$('.work-dock'))) return;
  const launcher = await page.$('.work-launcher');
  if (launcher) {
    if (open) await launcher.click();
    else return;
  }
  const toggle = await page.$('.work-panel-heading button[aria-expanded]');
  if (toggle && (await toggle.evaluate((n) => n.getAttribute('aria-expanded') === 'true')) !== open)
    await toggle.click();
}
async function upload(page, files, title) {
  await notifications(page, false);
  await page.click('.space-heading button');
  if (await page.$('[role="menuitem"]')) await button(page, '[role="menuitem"]', '레퍼런스 올리기');
  await page.waitForSelector('.space-dialog input[type="file"]');
  await (await page.$('.space-dialog input[type="file"]')).uploadFile(...files);
  if (title)
    await page.type('.space-dialog input[placeholder="비워두면 파일 이름을 사용합니다"]', title);
  await page.click('.space-dialog button[type="submit"]');
  await page.waitForSelector('.space-dialog', { hidden: true });
}
async function rename(page, name) {
  await page.$eval('.space-dialog input', (n) => {
    n.focus();
    n.select();
  });
  await page.keyboard.type(name);
  await page.click('.space-dialog button[type="submit"]');
}
module.exports = { fixtures, button, action, upload, rename, notifications };
