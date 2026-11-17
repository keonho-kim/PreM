// Purpose: Verify real native typography bounds, retained content and per-page extraction checks.
// Pattern: Independently authored synthetic text and owned QA workspaces; no model or business data.
// Usage: Bundled Node test runner after prepare-document-runtime; runtime dependencies stay local.
// Related: presentation-quality.py, presentation-render.py, presentation-validate.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const root = process.cwd();
const runtime = path.join(root, 'runtime');
const manifest = JSON.parse(
  await fs.readFile(path.join(runtime, 'document-manifest.json'), 'utf8'),
);
const python = path.resolve(runtime, manifest.python);
const node = path.resolve(runtime, manifest.node);
const artifactRoot = path.join(root, 'tests/.artifacts');
await fs.mkdir(artifactRoot, { recursive: true });
const frame = (x, y, width, height) => ({ x, y, width, height, rotation: 0 });
const spec = () => ({
  schema_version: 2,
  title: '검증용 업무 보고',
  bullets: ['업무 내용을 원문 그대로 보존합니다.'],
  notes: '',
  block_ids: ['11111111-1111-4111-8111-111111111111'],
  objects: [],
  layout: { title: frame(5, 10, 85, 12), body: frame(5, 30, 85, 56) },
});
async function render(input, repair, check, typography = null) {
  const dir = await fs.mkdtemp(path.join(artifactRoot, 'slide-quality-'));
  try {
    const original = JSON.stringify([input]);
    await fs.writeFile(path.join(dir, 'specs.json'), original);
    await fs.writeFile(path.join(dir, 'references.json'), '[]');
    await fs.writeFile(
      path.join(dir, 'render-options.json'),
      JSON.stringify({ repair, offset: 0, typography }),
    );
    const result = spawnSync(python, [path.join(runtime, 'presentation-render.py'), runtime, dir], {
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    });
    const report = JSON.parse(await fs.readFile(path.join(dir, 'quality.json'), 'utf8'));
    assert.equal(await fs.readFile(path.join(dir, 'specs.json'), 'utf8'), original);
    await check(report, result, dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
test('initial typography repair is bounded, preserves all Korean text and independently re-extracts it', async () => {
  const input = spec();
  input.layout.body.width = 42;
  input.layout.body.height = 50;
  input.bullets = Array.from(
    { length: 5 },
    (_, i) => `${i + 1} ${'보존할 원문 내용입니다'.repeat(7)}`,
  );
  await render(input, true, async (report, result, dir) => {
    assert.equal(result.status, 0, result.stderr);
    assert.equal(report.passed, true);
    assert.equal(report.repair_attempts, 2);
    await render(
      input,
      false,
      (saved, preview) => {
        assert.equal(preview.status, 0, preview.stderr);
        assert.equal(saved.passed, true);
        assert.equal(saved.repair_attempts, 0);
        assert.deepEqual(saved.typography, report.typography);
      },
      report.typography,
    );
    const checked = spawnSync(node, [path.join(runtime, 'presentation-validate.mjs'), dir], {
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    });
    assert.equal(checked.status, 0, checked.stderr);
  });
});
test('edit typography is never silently repaired and impossible layouts stop at the repair cap', async () => {
  const input = spec();
  input.layout.body = frame(5, 30, 15, 10);
  input.bullets = Array.from({ length: 5 }, (_, i) => `${i + 1} ${'내용 보존'.repeat(15)}`);
  for (const repair of [false, true])
    await render(input, repair, (report, result) => {
      assert.notEqual(result.status, 0);
      assert.equal(report.passed, false);
      assert.equal(report.repair_attempts, repair ? 2 : 0);
      assert.ok(report.issues.some((i) => i.code === 'text_overflow'));
    });
});
test('missing evidence blocks publication while deliberate artwork overlap remains a review warning', async () => {
  const missing = spec();
  missing.block_ids = [];
  await render(missing, true, (report, result) => {
    assert.notEqual(result.status, 0);
    assert.ok(report.issues.some((i) => i.code === 'evidence_missing'));
  });
  const art = spec();
  art.objects = ['a', 'b'].map((id) => ({
    id,
    name: id,
    frame: frame(70, 10, 20, 20),
    content: { kind: 'shape', shape: 'rectangle', fill: '#FFFFFF' },
  }));
  await render(art, true, (report, result) => {
    assert.equal(result.status, 0, result.stderr);
    assert.equal(report.passed, true);
    assert.ok(report.issues.some((i) => i.code === 'object_overlap' && i.severity === 'warning'));
  });
});
test('text on a different slide cannot satisfy the expected slide content', async () => {
  const dir = await fs.mkdtemp(path.join(artifactRoot, 'slide-location-'));
  try {
    const a = spec(),
      b = spec();
    a.title = 'Alpha source';
    a.bullets = ['First exact text'];
    b.title = 'Beta source';
    b.bullets = ['Second exact text'];
    await fs.writeFile(path.join(dir, 'specs.json'), JSON.stringify([a, b]));
    await fs.writeFile(path.join(dir, 'references.json'), '[]');
    const make = spawnSync(
      python,
      [
        '-c',
        [
          'import sys; sys.path.insert(0,sys.argv[1])',
          'from pptx import Presentation',
          'from pptx.util import Inches',
          'p=Presentation()',
          'for title,body in [("Beta source","Second exact text"),("Alpha source","First exact text")]:',
          ' s=p.slides.add_slide(p.slide_layouts[6]); s.shapes.add_textbox(Inches(1),Inches(1),Inches(6),Inches(2)).text=title+"\\n"+body',
          'p.save(sys.argv[2])',
        ].join('\n'),
        path.join(runtime, 'python-packages'),
        path.join(dir, 'output.pptx'),
      ],
      { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } },
    );
    assert.equal(make.status, 0, make.stderr);
    const result = spawnSync(node, [path.join(runtime, 'presentation-validate.mjs'), dir], {
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /output_text_missing/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
