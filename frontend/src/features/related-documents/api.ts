// Purpose: Validate related-search projections and preserve explicit request/version identities.
// Pattern: Query owns remote runs; typed POST/PUT commands never copy source bodies.
// Usage: Studio search, source selection and Admin model choice.
// Related: backend/adapters/http/relations.rs.
import { z } from 'zod';
import { request } from '@/shared/api/http';
const options = z.object({
  include_archived: z.boolean(),
  previous_versions: z.boolean(),
  source_project: z.uuid().nullable(),
  format: z.string().nullable(),
  since: z.number().nullable(),
});
export type SearchInput = { query: string; options: z.infer<typeof options> };
const runSchema = z.object({
  id: z.uuid(),
  project_id: z.uuid(),
  query: z.string(),
  options,
  status: z.enum([
    'queued',
    'running',
    'waiting_configuration',
    'succeeded',
    'failed',
    'cancelled',
  ]),
  version: z.number(),
  total: z.number(),
  completed: z.number(),
  cache_hits: z.number(),
  stale: z.boolean(),
  error_code: z.string().nullable(),
  created_at: z.number(),
  exploration: z
    .object({
      phase: z.enum(['compare', 'context', 'discover', 'complete']),
      round: z.number(),
      read_blocks: z.number(),
      added_candidates: z.number(),
      unresolved: z.number(),
      stop_reason: z.enum(['reviewed', 'needs_review', 'no_new_results', 'budget']).nullable(),
    })
    .nullable()
    .optional(),
});
export type SearchRun = z.infer<typeof runSchema>;
const origin = z.object({
  source_version_id: z.uuid(),
  project_id: z.uuid(),
  project_name: z.string(),
  item_id: z.uuid(),
  item_version: z.number(),
  file_version: z.number(),
  filename: z.string(),
  job_id: z.uuid(),
  available: z.boolean(),
});
export type Origin = z.infer<typeof origin>;
const item = z.object({
  evidence_version: z.number().optional(),
  id: z.uuid(),
  kind: z.enum(['file', 'block']),
  relation: z.number().nullable(),
  excerpt: z.string(),
  page_label: z.string(),
  page_id: z.uuid(),
  preview: z.string().nullable(),
  origins: z.array(origin),
  origin_count: z.number(),
  project_count: z.number(),
  selection_id: z.string(),
  selection_version: z.number(),
  selected: z.boolean(),
});
export type RelatedItem = z.infer<typeof item>;
const results = z.object({ total: z.number(), offset: z.number(), items: z.array(item) });
const settings = z.object({
  version: z.number(),
  connection_id: z.uuid().nullable(),
  planner_connection_id: z.uuid().nullable().optional(),
});
export const relationKeys = {
  all: ['relations'] as const,
  run: (p: string, id: string | null) => ['relations', 'run', p, id] as const,
  results: (p: string, id: string, k: string, o: number) =>
    ['relations', 'results', p, id, k, o] as const,
  selected: (p: string) => ['relations', 'selected', p] as const,
  settings: ['relation-settings'] as const,
};
export const terminal = (s: string) => ['succeeded', 'failed', 'cancelled'].includes(s);
const base = (p: string) => `/api/v1/projects/${p}`;
export const getRun = (p: string, id: string | null, signal: AbortSignal) =>
  request(`${base(p)}/related-searches${id ? `/${id}` : ''}`, runSchema.nullable(), { signal });
export const search = (p: string, input: SearchInput, key: string) =>
  request(`${base(p)}/related-searches`, runSchema, {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: JSON.stringify(input),
    timeout: 30000,
  });
export const getResults = (
  p: string,
  id: string,
  kind: string,
  offset: number,
  signal: AbortSignal,
) =>
  request(
    `${base(p)}/related-searches/${id}/results?${new URLSearchParams({ kind, offset: String(offset) })}`,
    results,
    { signal },
  );
export const getOrigins = (p: string, id: string, offset: number, signal: AbortSignal) =>
  request(`${base(p)}/related-candidates/${id}/origins?offset=${offset}`, z.array(origin), {
    signal,
  });
export const command = (p: string, run: SearchRun, action: 'retry' | 'cancel', key: string) =>
  request(`${base(p)}/related-searches/${run.id}/${action}`, runSchema, {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: JSON.stringify({ expected_version: run.version }),
  });
export const getSelected = (p: string, signal: AbortSignal) =>
  request(`${base(p)}/related-items`, results, { signal });
export const selectItem = (p: string, value: RelatedItem) =>
  request(
    `${base(p)}/related-items`,
    z.object({ id: z.string(), version: z.number(), active: z.boolean() }),
    {
      method: 'PUT',
      body: JSON.stringify({
        candidate_id: value.id,
        source_version_id: value.origins[0]?.source_version_id,
        expected_version: value.selection_version,
        selected: !value.selected,
      }),
    },
  );
export const getSettings = (signal: AbortSignal) =>
  request('/api/v1/admin/related-search/settings', settings, { signal });
export const saveSettings = (
  expected_version: number,
  connection_id: string | null,
  planner_connection_id: string | null = null,
) =>
  request('/api/v1/admin/related-search/settings', settings, {
    method: 'PUT',
    body: JSON.stringify({ expected_version, connection_id, planner_connection_id }),
  });

export const getEvidence = (project: string, candidate: string, signal: AbortSignal) =>
  request(
    `${base(project)}/related-candidates/${candidate}/evidence`,
    z.array(
      z.object({
        block_id: z.uuid(),
        page_id: z.uuid(),
        page_label: z.string(),
        text: z.string(),
        truncated: z.boolean(),
        origin,
        comparison: z.boolean(),
      }),
    ),
    { signal },
  );
