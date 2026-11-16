// Purpose: Define versioned preparation, durable generation and immutable slide read contracts.
// Pattern: Zod validation at HTTP boundaries; Query owns canonical server state.
// Usage: Studio evidence/template/generation feature; commands retain request identity on retry.
// Related: backend/modules/presentations/, shared/api/http.ts.
import { z } from 'zod';
import { request } from '@/shared/api/http';
const preparation = z.object({
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
export type Preparation = z.infer<typeof preparation>;
const run = z.object({
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
});
export type Run = z.infer<typeof run>;
const slide = z.object({
  id: z.uuid(),
  position: z.number(),
  preview: z.boolean(),
  spec: z
    .object({
      schema_version: z.number(),
      title: z.string(),
      bullets: z.array(z.string()),
      notes: z.string(),
      block_ids: z.array(z.uuid()),
    })
    .nullable(),
});
export type Slide = z.infer<typeof slide>;
export type Generate = {
  design_id: string;
  title: string;
  instructions: string;
  connection_id: string;
  model_version: number;
  presentation_id: string | null;
  expected_version: number;
};
const base = (p: string) => `/api/v1/projects/${p}`;
export const presentationKeys = {
  all: ['presentations'] as const,
  preparation: (p: string) => ['presentations', p, 'preparation'] as const,
  runs: (p: string) => ['presentations', p, 'runs'] as const,
  slides: (p: string, id: string) => ['presentations', p, id, 'slides'] as const,
};
export const getPreparation = (p: string, signal: AbortSignal) =>
  request(`${base(p)}/presentation-preparation`, preparation, { signal });
export const confirmEvidence = (p: string, fingerprint: string) =>
  request(`${base(p)}/presentation-preparation/evidence`, preparation, {
    method: 'POST',
    body: JSON.stringify({ fingerprint }),
  });
export const saveDesign = (p: string, state: Preparation, template_job_id: string | null) =>
  request(`${base(p)}/presentation-preparation/design`, preparation, {
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
