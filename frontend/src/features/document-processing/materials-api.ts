// Purpose: Read and resolve immutable reusable reference parts without generating a presentation.
// Pattern: Validated lineage and item IDs over the same-origin API; selection is scoped to one job.
// Usage: ReferenceMaterials owns the visible catalog and local ordered selection.
// Related: backend/modules/documents/materials.rs, reference-materials.tsx.
import { z } from 'zod';
import { request } from '@/shared/api/http';
const material = z.object({
  id: z.uuid(),
  page_id: z.uuid(),
  page_label: z.string(),
  source_page: z.number().nullable(),
  kind: z.enum(['slide', 'page', 'image', 'diagram', 'chart', 'text', 'table']),
  title: z.string(),
  text: z.string().nullable(),
  content_block_id: z.uuid().nullable(),
  preview: z.string().nullable(),
  preview_scope: z.enum(['item', 'page', 'none']),
  native: z
    .object({
      slide_part: z.string(),
      shape_ids: z.array(z.string()),
      image_part: z.string().nullable(),
      image_asset: z.string().nullable(),
    })
    .nullable(),
});
const catalog = z.object({
  schema_version: z.literal(1),
  reference_id: z.uuid(),
  job_id: z.uuid(),
  file_version: z.number(),
  source_sha256: z.string(),
  extraction_id: z.uuid().nullable(),
  bundle: z.string().nullable(),
  ready: z.boolean(),
  total: z.number(),
  items: z.array(material),
});
export type Material = z.infer<typeof material>;
export const materialKeys = {
  list: (job: string, kind: string, query: string, offset: number) =>
    ['processing', 'materials', job, kind, query, offset] as const,
};
export const getMaterials = (
  job: string,
  kind: string,
  q: string,
  offset: number,
  signal: AbortSignal,
) =>
  request(
    `/api/v1/document-jobs/${job}/materials?${new URLSearchParams({ kind, q, offset: String(offset) })}`,
    catalog,
    { signal },
  );
export const resolveMaterials = (job: string, material_ids: string[], signal: AbortSignal) =>
  request(`/api/v1/document-jobs/${job}/materials/resolve`, catalog, {
    method: 'POST',
    body: JSON.stringify({ material_ids }),
    signal,
  });
