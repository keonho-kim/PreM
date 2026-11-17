// Purpose: Keep pointer, keyboard and numeric geometry changes inside the same slide bounds.
// Pattern: Pure percentage-frame transforms; one selected group shares a clamped movement delta.
// Usage: ObjectSelection and non-drag geometry controls; no persistence or browser APIs.
// Related: slide-spec.ts, canvas-geometry.test.ts, canvas-api.ts.
import type { ObjectFrame, SlideObject } from './slide-spec';
export type Placements = Record<string, ObjectFrame>;
const round = (n: number) => Math.round(n * 1000) / 1000;
export function bounded(frame: ObjectFrame): ObjectFrame {
  const width = round(Math.max(1, Math.min(100, frame.width))),
    height = round(Math.max(1, Math.min(100, frame.height)));
  return {
    ...frame,
    x: round(Math.max(0, Math.min(100 - width, frame.x))),
    y: round(Math.max(0, Math.min(100 - height, frame.y))),
    width: round(width),
    height: round(height),
  };
}
export function translated(
  objects: SlideObject[],
  ids: string[],
  dx: number,
  dy: number,
): Placements {
  const selected = objects.filter((o) => ids.includes(o.id));
  if (!selected.length) return {};
  const x = Math.max(
    -Math.min(...selected.map((o) => o.frame.x)),
    Math.min(dx, 100 - Math.max(...selected.map((o) => o.frame.x + o.frame.width))),
  );
  const y = Math.max(
    -Math.min(...selected.map((o) => o.frame.y)),
    Math.min(dy, 100 - Math.max(...selected.map((o) => o.frame.y + o.frame.height))),
  );
  return Object.fromEntries(
    selected.map((o) => [o.id, bounded({ ...o.frame, x: o.frame.x + x, y: o.frame.y + y })]),
  );
}
export function changed(objects: SlideObject[], frames: Placements) {
  return Object.entries(frames).some(
    ([id, f]) => JSON.stringify(objects.find((o) => o.id === id)?.frame) !== JSON.stringify(f),
  );
}
