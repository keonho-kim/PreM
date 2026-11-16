// Purpose: Validate the text-only choice decision boundary and normalized responses.
// Pattern: Zod inputs and outputs over shared Axios; model selection stays server-pinned.
// Usage: Admin's explicit batch test, separate from generation diagnostics.
// Related: decision-checks.tsx, backend/modules/decisions/.
import { capacityBounds } from './capacity-api';
import { z } from 'zod';
import { request } from '@/shared/api/http';
import { recordSchema, type Provider } from './api';
const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const choices = z
  .record(id, z.string().trim().min(1).max(2048))
  .refine((v) => Object.keys(v).length >= 2 && Object.keys(v).length <= 16);
export const questionsSchema = z
  .record(
    id,
    z.strictObject({
      type: z.literal('choice'),
      instructions: z.string().trim().min(1).max(2048),
      criteria: choices,
    }),
  )
  .refine((v) => Object.keys(v).length >= 1 && Object.keys(v).length <= 16);
const responseSchema = z.object({
  request: recordSchema,
  result: z.object({
    model: z.string(),
    statistics: z.enum(['unavailable', 'provider_reported']),
    answers: z.record(
      z.string(),
      z.object({
        choice: z.string(),
        probabilities: z.record(z.string(), z.number().min(0).max(1)).nullable(),
        confidence: z.number().min(0).max(1).nullable(),
      }),
    ),
  }),
});
export const evaluateDecision = (
  provider: Provider,
  state: string,
  questions: string,
  signal: AbortSignal,
) =>
  request(`/api/v1/admin/decisions/${provider.id}/evaluate`, responseSchema, {
    method: 'POST',
    // Preserve duplicate keys for the server to reject instead of silently normalizing them.
    body: `{"expected_version":${provider.version},"batch":{"state":${JSON.stringify(state)},"questions":${questions}}}`,
    signal,
    timeout: (provider.timeout_seconds + capacityBounds.wait + 5) * 1000,
  });
