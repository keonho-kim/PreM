// Purpose: Validate blank deck/layout contracts and explicit deterministic canvas commands.
// Pattern: Existing Axios transport, project scope, immutable base version and idempotency key.
// Usage: Manual start and direct canvas interaction; provider execution stays in Rust.
// Related: backend/modules/presentations/canvas.rs, use-canvas-command.ts, blank-form.tsx.
import { z } from 'zod';
import { request } from '@/shared/api/http';
import { frameSchema, type ObjectFrame, type SlideObject } from './slide-spec';
import { runSchema } from './api';
const layoutSchema = z.array(
  z.object({
    key: z.string(),
    name: z.string(),
    slots: z.array(z.object({ role: z.string(), frame: frameSchema })),
    preview_page: z.number().nullable(),
  }),
);
export type CanvasOperation =
  | { kind: 'geometry'; placements: { object_id: string; frame: ObjectFrame }[] }
  | { kind: 'insert'; object: SlideObject }
  | { kind: 'text'; object_id: string; text: string }
  | { kind: 'add_slide'; layout_key: string }
  | { kind: 'duplicate_slide' }
  | { kind: 'delete_slide' }
  | { kind: 'move_slide'; position: number };
export const canvasKeys = {
  layouts: (p: string, job: string | null, run?: string) =>
    ['presentation-layouts', p, job, run] as const,
};
export function getLayouts(p: string, job: string | null, signal: AbortSignal, run?: string) {
  const q = new URLSearchParams();
  if (job) q.set('template_job_id', job);
  if (run) q.set('run_id', run);
  return request(`/api/v1/projects/${p}/presentation-layouts?${q}`, layoutSchema, { signal });
}
export function createBlank(
  p: string,
  key: string,
  input: { title: string; template_job_id: string | null; layout_key: string },
) {
  return request(`/api/v1/projects/${p}/presentations/blank`, runSchema, {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: JSON.stringify(input),
  });
}
export function applyCanvas(
  p: string,
  base: string,
  key: string,
  input: {
    expected_version: number;
    slide_id: string;
    session: string | null;
    operation: CanvasOperation;
  },
) {
  return request(`/api/v1/projects/${p}/presentations/${base}/canvas`, runSchema, {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: JSON.stringify(input),
  });
}

const layersSchema = z.array(z.object({ id: z.string(), frame: frameSchema }));
export const getCanvasLayers = (p: string, run: string, slide: string, signal: AbortSignal) =>
  request(`/api/v1/projects/${p}/presentations/${run}/slides/${slide}/layers`, layersSchema, {
    signal,
  });
export const canvasLayerUrl = (p: string, run: string, slide: string, id: string) =>
  `/api/v1/projects/${p}/presentations/${run}/slides/${slide}/layers/${encodeURIComponent(id)}`;
