// Purpose: Read public writing-model choices without administrative connection metadata.
// Pattern: Minimal DTO and independent Query key prevent sensitive cache reuse in Studio.
// Usage: Outline and presentation authoring; Admin retains its protected management APIs.
// Related: backend/adapters/http/authoring_models.rs, api.ts.
import { z } from 'zod';
import { request } from '@/shared/api/http';
const choice = z.object({
  id: z.uuid(),
  name: z.string(),
  model_identifier: z.string(),
  version: z.number(),
});
export const authoringModelsKey = ['authoring-models'] as const;
export const listAuthoringModels = (signal: AbortSignal) =>
  request('/api/v1/models/authoring', z.array(choice), { signal });
