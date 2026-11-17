// Purpose: Validate bounded per-slide quality summaries at the API boundary.
// Pattern: Fixed report structure; source text and tool diagnostics stay on the server.
// Usage: Generation history and slide-edit read contracts.
// Related: quality-status.tsx, backend/modules/presentations/quality.rs.
import { z } from 'zod';
export const qualitySchema = z
  .array(
    z.object({
      position: z.number().int().positive(),
      reused: z.boolean(),
      report: z.object({
        schema_version: z.literal(1),
        passed: z.boolean(),
        repair_attempts: z.number().int().min(0).max(2),
        issues: z
          .array(z.object({ code: z.string(), severity: z.enum(['warning', 'error']) }))
          .max(64),
      }),
    }),
  )
  .max(24);
export type SlideQuality = z.infer<typeof qualitySchema>[number];
