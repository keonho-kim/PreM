// Purpose: Validate durable conversational edit proposals and explicit revision-apply commands.
// Pattern: Scoped query keys, pinned base/model versions and idempotent write receipts.
// Usage: SlideChat and proposal review; all transport stays with Rust's existing model gateway.
// Related: backend/modules/presentations/edits.rs, chat-drafts.ts.
import { z } from 'zod';
import { qualitySchema } from './quality-schema';
import { slideSpecSchema as spec } from './slide-spec';
import { request } from '@/shared/api/http';
const edit = z.object({
  quality: qualitySchema.optional(),
  steps: z.array(z.object({ key: z.string(), state: z.string(), attempt: z.number() })).optional(),
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
  preview: z.boolean().default(false),
  before: spec,
  proposal: spec.nullable(),
  targets: z
    .array(
      z.object({
        slide_id: z.uuid(),
        position: z.number(),
        completed: z.boolean(),
        object_ids: z.array(z.string()),
      }),
    )
    .optional(),
  slides: z
    .array(
      z.object({
        slide_id: z.uuid(),
        position: z.number(),
        before: spec,
        proposal: spec.nullable(),
      }),
    )
    .optional(),
});
export type Edit = z.infer<typeof edit>;
export type EditRequest = {
  expected_version: number;
  prompt: string;
  fields: string[];
  slide_ids?: string[];
  object_ids?: string[];
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
  session?: string | null,
) =>
  request(`/api/v1/projects/${p}/slide-edits/${e.id}/${action}`, edit, {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: JSON.stringify({ expected_version: e.version, editor_session_id: session ?? undefined }),
  });
