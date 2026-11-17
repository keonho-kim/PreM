// Purpose: Generate the production UI theme from the single Folio design source.
// Pattern: Build-time adapter with deterministic output and a read-only check mode.
// Usage: pnpm tokens or pnpm tokens:check from the repository root.
// Related: design/refract.tokens.json, frontend/src/app/styles/theme.generated.css.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';

const { values } = parseArgs({
  options: { check: { type: 'boolean', default: false } },
  allowPositionals: false,
  strict: true,
});
const root = new URL('../', import.meta.url);
const sourcePath = new URL('design/refract.tokens.json', root);
const source = await readFile(sourcePath, 'utf8');
const theme = JSON.parse(source);
const groups = ['properties', 'backdrop', 'reducedTransparency', 'forcedColors'];
if (theme.schema_version !== 1 || theme.mode !== 'light') {
  throw new Error('Unsupported design schema or color mode. PreM uses light mode only.');
}
for (const name of groups) {
  if (!theme[name] || typeof theme[name] !== 'object' || Array.isArray(theme[name])) {
    throw new Error(`Missing token group: ${name}`);
  }
  for (const [property, value] of Object.entries(theme[name])) {
    if (!/^--[a-z][a-z0-9-]*$/.test(property) || typeof value !== 'string' || /[{};]/.test(value)) {
      throw new Error(`Invalid CSS token: ${name}.${property}`);
    }
    if (name !== 'properties' && !Object.hasOwn(theme.properties, property)) {
      throw new Error(`Override without a base token: ${property}`);
    }
  }
}
const digest = createHash('sha256').update(source).digest('hex');
const block = (properties) =>
  ':root {\n' +
  Object.entries(properties)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n') +
  '\n}';
const css = `/* Hallmark · shape: app screen · genre: modern-minimal · theme: Furrow (Folio adaptation)
 * nav: project workspace · signature: source-linked slides · redesign: restyle · axes: light/grotesk-sans/warm · v2.0.0 */
/* Hallmark · pre-emit critique: P4 H4 E4 S5 R5 V4 · weakest: V, keep document content central */
/* Purpose: Provide shared opaque paper surfaces, ink, and command colors.
 * Pattern: Generated design tokens; do not edit this output directly.
 * Usage: Imported by the UI style composition root or token sheet.
 * Related: design/refract.tokens.json, scripts/generate-design-tokens.mjs. */
/* Source SHA-256: ${digest} */
${block(theme.properties)}
@supports (background-color: rgb(255 255 255 / 0.8)) {
  ${block(theme.backdrop)}
}
@media (prefers-reduced-transparency: reduce) {
  ${block(theme.reducedTransparency)}
}
@media (forced-colors: active) {
  ${block(theme.forcedColors)}
}
`;
const biome = fileURLToPath(new URL('../node_modules/@biomejs/biome/bin/biome', import.meta.url));
const output = execFileSync(process.execPath, [biome, 'format', '--stdin-file-path=theme.css'], {
  cwd: fileURLToPath(root),
  input: css,
  encoding: 'utf8',
});
const targets = [['frontend/src/app/styles/theme.generated.css', output]];
const check = values.check;
for (const [target, content] of targets) {
  const location = new URL(target, root);
  if (check) {
    const current = await readFile(location, 'utf8').catch(() => null);
    if (current !== content) throw new Error(`${target} is stale. Run pnpm tokens.`);
  } else {
    await mkdir(new URL('./', location), { recursive: true });
    await writeFile(location, content);
  }
}
console.log(
  check ? 'Shared Folio tokens are current.' : 'Generated Folio tokens for the frontend.',
);
