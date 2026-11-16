// Purpose: Check contrast on Folio paper surfaces and opaque accessibility fallbacks.
// Pattern: Browser inspection with pure color calculations and restored test overrides.
// Usage: Required by mock/helpers/capture.cjs after a screen is ready.
// Related: design/refract.tokens.json, mock/theme.generated.css, mock/helpers/browser.cjs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { projectRoot } = require('./browser.cjs');

const rgba = (value) => {
  const hex = value.trim().replace('#', '');
  assert.match(hex, /^(?:[\da-f]{6}|[\da-f]{8})$/i, 'Expected a resolved hex color: ' + value);
  const bytes = hex.match(/../g).map((part) => parseInt(part, 16));
  return [...bytes.slice(0, 3), bytes.length === 4 ? bytes[3] / 255 : 1];
};
const over = (foreground, background) => [
  ...foreground
    .slice(0, 3)
    .map((channel, index) => channel * foreground[3] + background[index] * (1 - foreground[3])),
  1,
];
function contrast(a, b) {
  const luminance = (color) =>
    color
      .slice(0, 3)
      .map((channel) => channel / 255)
      .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
      .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
module.exports = async function inspectTheme(page) {
  const names = [
    'ink',
    'muted',
    'paper',
    'paper-2',
    'workspace',
    'accent',
    'accent-soft',
    'brand',
    'brand-ink',
    'water',
    'control',
    'focus',
  ];
  const values = await page.evaluate((names) => {
    const css = getComputedStyle(document.documentElement);
    return Object.fromEntries([
      ...names.map((name) => [name, css.getPropertyValue('--color-' + name).trim()]),
      ...['glass-panel', 'glass-control'].map((name) => [
        name,
        css.getPropertyValue('--' + name).trim(),
      ]),
    ]);
  }, names);
  const colors = Object.fromEntries(
    Object.entries(values).map(([name, value]) => [name, rgba(value)]),
  );
  const anchors = ['paper', 'workspace', 'water'].map((name) => colors[name]);
  const panel = anchors.map((base) => over(colors['glass-panel'], base));
  const input = anchors.map((base) => over(colors['glass-control'], base));
  const contrasts = [
    ['Body text on paper', colors.ink, panel, 4.5],
    ['Secondary text on workspace surfaces', colors.muted, anchors, 4.5],
    ['Selected navigation', colors.accent, [colors['accent-soft']], 4.5],
    ['Tangerine primary command', colors['brand-ink'], [colors.brand], 4.5],
    ['Input boundary', colors.control, input, 3],
    ['Keyboard focus on paper', colors.focus, panel, 3],
  ].map(([name, foreground, backgrounds, minimum]) => {
    const ratio = Math.min(...backgrounds.map((background) => contrast(foreground, background)));
    assert.ok(ratio >= minimum, name + ': ' + ratio.toFixed(2));
    return { name, ratio: Number(ratio.toFixed(2)), minimum };
  });
  const material = await page.$eval('.editor-stage', (node) => ({
    filter: getComputedStyle(node).backdropFilter,
    background: getComputedStyle(node).backgroundColor,
    bodyOpacity: getComputedStyle(document.body).opacity,
  }));
  assert.equal(material.bodyOpacity, '1');
  assert.equal(material.filter, 'none', 'Folio uses opaque unfiltered surfaces');
  const theme = JSON.parse(
    fs.readFileSync(path.join(projectRoot, 'design/refract.tokens.json'), 'utf8'),
  );
  const fallback = await page.evaluate((properties) => {
    const root = document.documentElement,
      saved = [];
    try {
      for (const [name, value] of Object.entries(properties)) {
        saved.push([name, root.style.getPropertyValue(name), root.style.getPropertyPriority(name)]);
        root.style.setProperty(name, value);
      }
      const css = getComputedStyle(document.querySelector('.editor-stage'));
      return {
        filter: css.backdropFilter,
        background: css.backgroundColor,
        header: getComputedStyle(root).getPropertyValue('--glass-header').trim(),
      };
    } finally {
      for (const [name, value, priority] of saved) {
        if (value) root.style.setProperty(name, value, priority);
        else root.style.removeProperty(name);
      }
    }
  }, theme.reducedTransparency);
  assert.equal(fallback.filter, 'none');
  assert.match(fallback.background, /^rgb\(/, 'Fallback panel must be opaque');
  assert.equal(rgba(fallback.header)[3], 1, 'Fallback table headers must also be opaque');
  return {
    contrasts,
    material,
    fallback: {
      ...fallback,
      method: 'Opaque recipe simulation; not a legacy browser certification.',
    },
  };
};
