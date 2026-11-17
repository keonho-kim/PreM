// Purpose: Define versioned preparation, durable generation and immutable slide read contracts.
// Pattern: Zod validation at HTTP boundaries; Query owns canonical server state.
// Usage: Studio evidence/template/generation feature; commands retain request identity on retry.
// Related: backend/modules/presentations/, shared/api/http.ts.
import { z } from 'zod';
import type { OutlineEdit } from '@/features/outlines';
import { qualitySchema } from './quality-schema';
import { slideSpecSchema } from './slide-spec';
import { request } from '@/shared/api/http';
const preparationSchema = z.object({
  version: z.number(),
  fingerprint: z.string(),
  ready: z.boolean(),
  evidence_review_id: z.uuid().nullable(),
  selected_count: z.number(),
  design_id: z.uuid().nullable(),
  template_job_id: z.uuid().nullable(),
  slide_count: z.number(),
  generated: z.boolean(),
});
export type Preparation = z.infer<typeof preparationSchema>;
const run = z.object({
  manual: z.boolean().optional(),
  id: z.uuid(),
  project_id: z.uuid(),
  presentation_id: z.uuid(),
  presentation_version: z.number(),
  is_current: z.boolean(),
  title: z.string(),
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']),
  stage: z.enum(['writing', 'rendering', 'complete']),
  version: z.number(),
  completed: z.number(),
  total: z.number(),
  error_code: z.string().nullable(),
  created_at: z.number(),
  quality: qualitySchema.optional(),
  steps: z.array(z.object({ key: z.string(), state: z.string(), attempt: z.number() })).optional(),
});
export type Run = z.infer<typeof run>;
const slide = z.object({
  id: z.uuid(),
  position: z.number(),
  preview: z.boolean(),
  spec: slideSpecSchema.nullable(),
});
export type Slide = z.infer<typeof slide>;
export type Generate = {
  node_ids?: string[];
  materials?: { job_id: string; material_id: string }[];
  design_id: string;
  title: string;
  instructions: string;
  connection_id?: string;
  model_version?: number;
  presentation_id: string | null;
  expected_version: number;
};
const base = (p: string) => `/api/v1/projects/${p}`;
const section = z.object({ id: z.uuid(), parent_id: z.uuid().nullable(), title: z.string() });
export type GenerationSection = z.infer<typeof section>;
const scopeSchema = z.object({ outline_revision_id: z.uuid(), sections: z.array(section) });
export const getGenerationScope = (p: string, design: string, signal: AbortSignal) =>
  request(
    `${base(p)}/presentation-preparation/sections?design_id=${encodeURIComponent(design)}`,
    scopeSchema,
    { signal },
  );
export const presentationKeys = {
  all: ['presentations'] as const,
  preparation: (p: string) => ['presentations', p, 'preparation'] as const,
  runs: (p: string) => ['presentations', p, 'runs'] as const,
  slides: (p: string, id: string) => ['presentations', p, id, 'slides'] as const,
};
export const getPreparation = (p: string, signal: AbortSignal) =>
  request(`${base(p)}/presentation-preparation`, preparationSchema, { signal });
export const confirmEvidence = (p: string, fingerprint: string) =>
  request(`${base(p)}/presentation-preparation/evidence`, preparationSchema, {
    method: 'POST',
    body: JSON.stringify({ fingerprint }),
  });
export const saveDesign = (p: string, state: Preparation, template_job_id: string | null) =>
  request(`${base(p)}/presentation-preparation/design`, preparationSchema, {
    method: 'PUT',
    body: JSON.stringify({
      expected_version: state.version,
      evidence_review_id: state.evidence_review_id,
      template_job_id,
    }),
  });
export const listRuns = (p: string, signal: AbortSignal) =>
  request(`${base(p)}/presentations`, z.array(run), { signal });
export const createRun = (p: string, key: string, input: Generate) =>
  request(`${base(p)}/presentations`, run, {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: JSON.stringify(input),
  });
export const controlRun = (p: string, r: Run, action: 'retry' | 'cancel', key: string) =>
  request(`${base(p)}/presentations/${r.id}/${action}`, run, {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: JSON.stringify({ expected_version: r.version }),
  });
export const listSlides = (p: string, id: string, signal: AbortSignal) =>
  request(`${base(p)}/presentations/${id}/slides`, z.array(slide), { signal });
export const downloadUrl = (p: string, id: string) => `${base(p)}/presentations/${id}/download`;
export const previewUrl = (p: string, id: string, slide: string) =>
  `${base(p)}/presentations/${id}/slides/${slide}/preview`;
const citation = z.object({
  block_id: z.uuid(),
  text: z.string(),
  filename: z.string(),
  page_id: z.uuid(),
  page_label: z.string(),
  project_id: z.uuid(),
  item_id: z.uuid(),
  item_version: z.number(),
  file_version: z.number(),
  job_id: z.uuid(),
  available: z.boolean(),
});
export type Citation = z.infer<typeof citation>;
export const getCitations = (p: string, id: string, slide: string, signal: AbortSignal) =>
  request(`${base(p)}/presentations/${id}/slides/${slide}/evidence`, z.array(citation), { signal });

export { run as runSchema };

export const saveGenerationOutline = (project: string, outline: OutlineEdit, state: Preparation) =>
  request(`/api/v1/projects/${project}/outline-for-presentation`, preparationSchema, {
    method: 'PUT',
    body: JSON.stringify({
      outline,
      template_job_id: state.template_job_id,
      expected_design_version: state.version,
    }),
  });
