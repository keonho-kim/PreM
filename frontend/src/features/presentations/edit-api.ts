// Purpose: Validate durable conversational edit proposals and explicit revision-apply commands.
// Pattern: Scoped query keys, pinned base/model versions and idempotent write receipts.
// Usage: SlideChat and proposal review; all transport stays with Rust's existing model gateway.
// Related: backend/modules/presentations/edits.rs, chat-drafts.ts.
import { z } from 'zod';
import { request } from '@/shared/api/http';
const spec = z.object({
  schema_version: z.number(),
  title: z.string(),
  bullets: z.array(z.string()),
  notes: z.string(),
  block_ids: z.array(z.uuid()),
});
const edit = z.object({
  id: z.uuid(),
  project_id: z.uuid(),
  presentation_id: z.uuid(),
  base_revision_id: z.uuid(),
  base_version: z.number(),
  source_slide_id: z.uuid(),
  connection_id: z.uuid(),
  prompt: z.string(),
  fields: z.array(z.string()),
  status: z.enum([
    'queued',
    'running',
    'ready',
    'applying',
    'applied',
    'failed',
    'cancelled',
    'rejected',
  ]),
  version: z.number(),
  message: z.string().nullable(),
  error_code: z.string().nullable(),
  applied_run_id: z.uuid().nullable(),
  render_status: z.string().nullable(),
  created_at: z.number(),
  before: spec,
  proposal: spec.nullable(),
});
export type Edit = z.infer<typeof edit>;
export type EditRequest = {
  expected_version: number;
  connection_id: string;
  model_version: number;
  prompt: string;
  fields: string[];
};
export const editKeys = {
  all: ['presentation-edits'] as const,
  thread: (p: string, r: string, s: string) => ['presentation-edits', p, r, s] as const,
};
const thread = (p: string, r: string, s: string) =>
  `/api/v1/projects/${p}/presentations/${r}/slides/${s}/edits`;
export const getEdits = (p: string, r: string, s: string, signal: AbortSignal) =>
  request(thread(p, r, s), z.array(edit), { signal });
export const sendEdit = (p: string, r: string, s: string, key: string, input: EditRequest) =>
  request(thread(p, r, s), edit, {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: JSON.stringify(input),
  });
export const editCommand = (
  p: string,
  e: Edit,
  action: 'apply' | 'reject' | 'retry' | 'cancel',
  key: string,
) =>
  request(`/api/v1/projects/${p}/slide-edits/${e.id}/${action}`, edit, {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: JSON.stringify({ expected_version: e.version }),
  });
