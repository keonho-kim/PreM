// Purpose: Define the read-only Space search boundary and URL filter values.
// Pattern: Query owns results, Router owns committed input; no model call on this route.
// Usage: SearchPage and search result rows.
// Related: backend/modules/search/, search-page.tsx.
import { z } from 'zod';
import { request } from '@/shared/api/http';
const item = z.object({
  id: z.uuid(),
  kind: z.enum(['references', 'templates']),
  title: z.string(),
  filename: z.string(),
  format: z.string(),
  file_version: z.number(),
  updated_at: z.number(),
  job_id: z.uuid().nullable(),
  page_id: z.uuid().nullable(),
  page_label: z.string().nullable(),
  preview: z.string().nullable(),
  excerpt: z.string(),
  name_match: z.boolean(),
  content_match: z.boolean(),
});
export type SearchItem = z.infer<typeof item>;
const results = z.object({
  items: z.array(item),
  total: z.number(),
  offset: z.number(),
  limit: z.number(),
});
export function searchParams(params: URLSearchParams) {
  const scope = params.get('scope') ?? 'all',
    mode = params.get('mode') ?? 'all';
  const offset = Number(params.get('offset') ?? 0);
  return {
    q: (params.get('q') ?? '').slice(0, 120),
    scope: ['references', 'templates'].includes(scope) ? scope : 'all',
    mode: ['files', 'content'].includes(mode) ? mode : 'all',
    archived: params.get('archived') === 'true',
    offset: Number.isInteger(offset) && offset >= 0 && offset <= 100000 ? offset : 0,
  };
}
export type SearchInput = ReturnType<typeof searchParams>;
export const encodeSearch = (input: SearchInput) =>
  new URLSearchParams({
    q: input.q,
    scope: input.scope,
    mode: input.mode,
    archived: String(input.archived),
    offset: String(input.offset),
  }).toString();
export const findDocuments = (input: SearchInput, signal: AbortSignal) =>
  request(`/api/v1/search?${encodeSearch(input)}`, results, { signal });
