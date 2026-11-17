// Purpose: Define immutable outline, source mapping and durable generation API projections.
// Pattern: Query owns committed state; editing requests carry explicit input/version conditions.
// Usage: Studio's outline/content workspace.
// Related: backend/adapters/http/outlines.rs, workspace.tsx.
import { z } from 'zod';
import { request } from '@/shared/api/http';
const node = z.object({
  id: z.uuid(),
  parent_id: z.uuid().nullable(),
  title: z.string(),
  description: z.string(),
});
const assignment = z.object({ node_id: z.uuid(), block_id: z.uuid() });
const draftSchema = z.object({ nodes: z.array(node), assignments: z.array(assignment) });
export type Draft = z.infer<typeof draftSchema>;
export type OutlineNode = z.infer<typeof node>;
const block = z.object({
  id: z.uuid(),
  source_version_id: z.uuid(),
  item_id: z.uuid(),
  file_version: z.number(),
  filename: z.string(),
  page_id: z.uuid(),
  page_label: z.string(),
  job_id: z.uuid(),
  kind: z.string(),
  text: z.string(),
  preview: z.string().nullable(),
});
export type SourceBlock = z.infer<typeof block>;
const run = z.object({
  id: z.uuid(),
  project_id: z.uuid(),
  kind: z.enum(['generate', 'map']),
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']),
  version: z.number(),
  total: z.number(),
  completed: z.number(),
  included_blocks: z.number(),
  total_blocks: z.number(),
  error_code: z.string().nullable(),
  result_revision_id: z.uuid().nullable(),
  steps: z.array(z.object({ key: z.string(), state: z.string(), attempt: z.number() })).optional(),
});
export type Run = z.infer<typeof run>;
const state = z.object({
  version: z.number(),
  revision_id: z.uuid().nullable(),
  source_snapshot: z.string(),
  guide_version: z.number(),
  stale: z.boolean(),
  confirmed: z.boolean(),
  ready: z.boolean(),
  draft: draftSchema,
  run: run.nullable(),
});
export type OutlineState = z.infer<typeof state>;
const base = (project: string) => `/api/v1/projects/${project}/outline`;
export const outlineKeys = {
  all: ['outlines'] as const,
  state: (p: string, r?: string) => ['outlines', p, 'state', r ?? 'current'] as const,
  history: (p: string) => ['outlines', p, 'history'] as const,
};
export const getOutline = (p: string, r: string | undefined, signal: AbortSignal) =>
  request(r ? `${base(p)}/revisions/${r}` : base(p), state, { signal });
export const saveOutline = (
  p: string,
  version: number,
  snapshot: string,
  guide: number,
  draft: Draft,
) =>
  request(base(p), state, {
    method: 'PUT',
    body: JSON.stringify({
      expected_version: version,
      source_snapshot: snapshot,
      guide_version: guide,
      draft,
    }),
  });
export const confirmOutline = (p: string, version: number) =>
  request(`${base(p)}/confirm`, state, {
    method: 'POST',
    body: JSON.stringify({ expected_version: version }),
  });
export const getHistory = (p: string, signal: AbortSignal) =>
  request(
    `${base(p)}/revisions`,
    z.array(
      z.object({ id: z.uuid(), number: z.number(), origin: z.string(), created_at: z.number() }),
    ),
    { signal },
  );
export const getBlocks = (
  p: string,
  r: string | undefined,
  q: string,
  offset: number,
  ids: string[] | undefined,
  signal: AbortSignal,
) =>
  request(
    `${base(p)}/blocks?${new URLSearchParams({ q, offset: String(offset), ...(r ? { revision: r } : {}), ...(ids ? { ids: ids.join(',') } : {}) })}`,
    z.object({ items: z.array(block), total: z.number(), offset: z.number() }),
    { signal },
  );
export type Generate = {
  expected_version: number;
  source_snapshot: string;
  guide_version: number;
  connection_id?: string;
  model_version?: number;
  kind: 'generate' | 'map';
  node_ids: string[];
};
export const createRun = (p: string, key: string, input: Generate) =>
  request(`${base(p)}/runs`, run, {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: JSON.stringify(input),
  });
export const commandRun = (p: string, r: Run, action: 'cancel' | 'retry', key: string) =>
  request(`${base(p)}/runs/${r.id}/${action}`, run, {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: JSON.stringify({ expected_version: r.version }),
  });
