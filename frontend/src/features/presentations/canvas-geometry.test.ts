// Purpose: Prove canvas motion preserves selected group spacing and handles zoom-independent bounds.
// Pattern: Independent percentage examples, edge clamping and unchanged-object checks.
// Usage: Vitest; real pointer/touch gestures have separate browser coverage.
// Related: canvas-geometry.ts, object-selection.tsx.
import { expect, test } from 'vitest';
import { bounded, translated, changed } from './canvas-geometry';
import type { SlideObject } from './slide-spec';
const object = (id: string, x: number, y: number): SlideObject => ({
  id,
  name: id,
  frame: { x, y, width: 20, height: 10, rotation: 0 },
  content: { kind: 'shape', shape: 'rectangle', fill: '#FFFFFF' },
});
test('multi-selection moves together and clamps the entire group at the slide edge', () => {
  const objects = [object('a', 10, 20), object('b', 60, 40), object('c', 30, 70)];
  const frames = translated(objects, ['a', 'b'], 50, -40);
  expect(frames.a?.x).toBe(30);
  expect(frames.b?.x).toBe(80);
  expect(frames.a?.y).toBe(0);
  expect(frames.b?.y).toBe(20);
  expect(frames.c).toBeUndefined();
  expect(objects[0]?.frame.x).toBe(10);
  expect(changed(objects, frames)).toBe(true);
});
test('fractional resize values do not round outside the slide or below minimum size', () => {
  const f = bounded({ x: 66.6665, y: -5, width: 33.3335, height: 0.1, rotation: 20 });
  expect(f.x + f.width).toBeLessThanOrEqual(100.00000001);
  expect(f.y).toBe(0);
  expect(f.height).toBe(1);
  expect(f.rotation).toBe(20);
  expect(changed([object('a', 10, 20)], translated([object('a', 10, 20)], ['a'], 0, 0))).toBe(
    false,
  );
});
