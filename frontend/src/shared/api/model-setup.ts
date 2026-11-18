// Purpose: Read public model setup flags without opening an Admin session.
// Pattern: One read-only snapshot for Home routing and setup feedback.
// Usage: Home checks on entry and Admin refreshes the notice after saved changes.
// Related: app/routing/router.tsx, pages/admin-page.tsx, adapters/http/authoring_models.rs.
import { z } from 'zod';
import { request } from './http';
const schema = z.object({ llm: z.boolean(), decision: z.boolean() });
export const modelSetupKey = ['model-setup'] as const;
export const getModelSetup = (signal: AbortSignal) =>
  request('/api/v1/models/setup', schema, { signal });
