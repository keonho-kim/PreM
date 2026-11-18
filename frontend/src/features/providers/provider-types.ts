// Purpose: Validate the server-owned provider catalog without duplicating identities or policies.
// Pattern: Wire schema only; defaults and capabilities come from model_registry.
// Usage: Admin reads catalog entries through TanStack Query and passes them to feature views.
// Related: api.ts, backend/modules/model_registry/kind.rs, provider-directory.tsx.
import { z } from 'zod';
const providerOptionSchema = z.object({
  category: z.enum(['llm', 'system']),
  id: z.string().min(1),
  label: z.string().min(1),
  protocol: z.string().min(1),
  base: z.url(),
  model: z.string(),
  structured: z.boolean(),
  default_physical_batch_size: z.number().int().positive().nullish(),
  key: z.boolean(),
  structured_reason: z.string().nullable(),
});
export const providerCatalogSchema = z
  .array(providerOptionSchema)
  .min(1)
  .max(100)
  .refine(
    (items) => new Set(items.map((item) => item.id)).size === items.length,
    'Provider catalog IDs must be unique',
  );
export type ProviderOption = z.infer<typeof providerOptionSchema>;
