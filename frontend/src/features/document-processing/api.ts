// Purpose: Validate processing job projections and explicit versioned commands.
// Pattern: Query owns shared durable state; UI never infers completion from upload progress.
// Usage: Space result dialog, tab-local work panel and Admin processing settings.
// Related: backend/adapters/http/documents.rs, status.tsx.
import { z } from 'zod';
import { request } from '@/shared/api/http';
const jobSchema = z.object({
  id: z.uuid(),
  kind: z.union([z.enum(['references', 'templates']), z.templateLiteral(['project-', z.uuid()])]),
  item_id: z.uuid(),
  file_version: z.number(),
  status: z.enum([
    'queued',
    'extracting',
    'classifying',
    'waiting_configuration',
    'succeeded',
    'failed',
    'cancelled',
  ]),
  version: z.number(),
  attempt: z.number(),
  extraction_id: z.uuid().nullable(),
  config_id: z.uuid().nullable(),
  error_code: z.string().nullable(),
  created_at: z.number(),
  updated_at: z.number(),
  total_blocks: z.number(),
  completed_blocks: z.number(),
  steps: z.array(z.object({ key: z.string(), state: z.string(), attempt: z.number() })).optional(),
});
export type Job = z.infer<typeof jobSchema>;
const pageSchema = z.object({
  alignment: z
    .object({
      role: z.enum(['start', 'body', 'contents', 'divider', 'divider_start', 'range', 'unknown']),
      section: z.string().nullable(),
      preceding_section: z.string().nullable(),
      printed_page: z.number().nullable(),
      toc_block: z.uuid().nullable(),
      evidence_block: z.uuid().nullable(),
    })
    .nullish(),
  id: z.uuid(),
  ordinal: z.number(),
  source_page: z.number().nullable(),
  label: z.string(),
  block_count: z.number(),
  preview: z.string().nullable(),
});
const templateSchema = z.object({
  schema_version: z.number(),
  manifest: z.record(z.string(), z.unknown()),
  native_structure: z.record(z.string(), z.unknown()),
  previews: z
    .array(
      z.object({ ordinal: z.number(), width: z.number(), height: z.number(), sha256: z.string() }),
    )
    .default([]),
});
const sourceEntry = z.object({
  title: z.string(),
  block: z.uuid(),
  line: z.number().int(),
  printed: z.number().int().nullable(),
});
const detailSchema = z.object({
  source_outline: z
    .array(sourceEntry.extend({ children: z.array(sourceEntry).optional() }))
    .optional(),
  reuse_ready: z.boolean().default(false),
  job: jobSchema,
  pages: z.array(pageSchema),
  page_mode: z.string().nullable(),
  warnings: z.array(z.string()),
  template: templateSchema.nullable(),
  template_extractable: z.boolean(),
  template_bundle: z.string().nullable(),
});
export type Detail = z.infer<typeof detailSchema>;
const blockSchema = z.object({
  id: z.uuid(),
  page_id: z.uuid(),
  position: z.number(),
  kind: z.string(),
  text: z.string(),
  attributes: z.record(z.string(), z.unknown()),
  is_table_of_contents: z.number().nullable(),
  image: z.string().nullable(),
});
export const processingKeys = {
  all: ['processing'] as const,
  detail: (kind: string, id: string, job?: string) =>
    ['processing', 'detail', kind, id, job] as const,
  blocks: (job: string, page: string, q: string, offset: number) =>
    ['processing', 'blocks', job, page, q, offset] as const,
  settings: ['processing-settings'] as const,
};
const processingPath = (kind: string, id: string) =>
  kind.startsWith('project-')
    ? `/api/v1/projects/${kind.slice(8)}/files/${id}/processing`
    : `/api/v1/space/${kind}/${id}/processing`;
export const getUploadJob = async (
  kind: string,
  id: string,
  version: number,
  signal: AbortSignal,
) => {
  const jobs = await request(
    `${processingPath(kind, id)}/history?file_version=${version}`,
    z.array(jobSchema),
    { signal },
  );
  return jobs[0] ?? null;
};
export const getDetail = (kind: string, id: string, job: string | undefined, signal: AbortSignal) =>
  request(`${processingPath(kind, id)}${job ? `?job=${job}` : ''}`, detailSchema, {
    signal,
  });
export const getBlocks = (
  job: string,
  page: string,
  q: string,
  offset: number,
  signal: AbortSignal,
) =>
  request(
    `/api/v1/document-jobs/${job}/blocks?${new URLSearchParams({ ...(page ? { page } : {}), q, offset: String(offset) })}`,
    z.array(blockSchema),
    { signal },
  );
export const fileUrl = (job: string, hash: string) => `/api/v1/document-jobs/${job}/files/${hash}`;
export const enqueue = (kind: string, id: string, expected_version: number, key: string) =>
  request(processingPath(kind, id), jobSchema, {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: JSON.stringify({ expected_version }),
  });
export const command = (job: Job, action: 'retry' | 'cancel', key: string) =>
  request(`/api/v1/document-jobs/${job.id}/${action}`, jobSchema, {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: JSON.stringify({ expected_version: job.version }),
  });
const settingsSchema = z.object({ version: z.number(), connection_id: z.uuid().nullable() });
export const getSettings = (signal: AbortSignal) =>
  request('/api/v1/admin/document-processing/settings', settingsSchema, { signal });
export const saveSettings = (expected_version: number, connection_id: string | null) =>
  request('/api/v1/admin/document-processing/settings', settingsSchema, {
    method: 'PUT',
    body: JSON.stringify({ expected_version, connection_id }),
  });
export const terminal = (status: string) => ['succeeded', 'failed', 'cancelled'].includes(status);
