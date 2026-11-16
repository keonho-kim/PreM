// Purpose: Validate source confirmation and optional guide revisions at the Studio boundary.
// Pattern: Query owns remote snapshots; conditional commands never start generation.
// Usage: Studio source and direction steps.
// Related: backend/adapters/http/studio.rs, guides.rs.
import { z } from 'zod';
import { request } from '@/shared/api/http';
const reviewSchema = z.object({
  snapshot: z.string(),
  ready: z.boolean(),
  confirmed: z.boolean(),
  count: z.number(),
});
const guideSchema = z.object({
  version: z.number(),
  do_text: z.string(),
  dont_text: z.string(),
});
export type Guide = z.infer<typeof guideSchema>;
export const studioKeys = {
  all: ['studio'] as const,
  review: (id: string) => ['studio', 'review', id] as const,
  files: (id: string, page: number) => ['studio', 'files', id, page] as const,
  guide: (id: string) => ['studio', 'guide', id] as const,
};
export const getReview = (id: string, signal: AbortSignal) =>
  request(`/api/v1/projects/${id}/source-review`, reviewSchema, { signal });
export const confirmSources = (id: string, snapshot: string) =>
  request(`/api/v1/projects/${id}/source-review`, reviewSchema, {
    method: 'PUT',
    body: JSON.stringify({ snapshot }),
  });
export const getGuide = (id: string, signal?: AbortSignal) =>
  request(`/api/v1/projects/${id}/guide`, guideSchema, { signal });
export const saveGuide = (id: string, guide: Guide) =>
  request(`/api/v1/projects/${id}/guide`, guideSchema, {
    method: 'PUT',
    body: JSON.stringify({
      expected_version: guide.version,
      do_text: guide.do_text,
      dont_text: guide.dont_text,
    }),
  });
