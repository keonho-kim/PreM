// Purpose: Validate connection capacity settings and version-conditional writes.
// Pattern: One feature API owner for numeric bounds and safe server projections.
// Usage: Capacity settings UI and model-call timeout budgeting.
// Related: backend/modules/model_execution/capacity.rs, provider-capacity.tsx.
import { z } from 'zod';
import { request } from '@/shared/api/http';
export const capacityBounds = { parallel: 1024, queue: 4096, wait: 600 } as const;
const limitsSchema = z.object({
  max_parallel: z.number().int().min(1).max(capacityBounds.parallel),
  queue_capacity: z.number().int().min(0).max(capacityBounds.queue),
  queue_timeout_seconds: z.number().int().min(1).max(capacityBounds.wait),
});
const capacitySchema = limitsSchema.extend({
  connection_id: z.uuid(),
  version: z.number().int().min(0),
  active: z.number().int().min(0),
  queued: z.number().int().min(0),
});
export type Capacity = z.infer<typeof capacitySchema>;
export type CapacityLimits = z.infer<typeof limitsSchema>;
export const capacityKey = (id: string) => ['provider-capacity', id] as const;
export const getCapacity = (id: string, signal: AbortSignal) =>
  request(`/api/v1/admin/llm/providers/${id}/capacity`, capacitySchema, { signal });
export const saveCapacity = (id: string, expected_version: number, limits: CapacityLimits) =>
  request(`/api/v1/admin/llm/providers/${id}/capacity`, capacitySchema, {
    method: 'PUT',
    body: JSON.stringify({ expected_version, ...limitsSchema.parse(limits) }),
  });
