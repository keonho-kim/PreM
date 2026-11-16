// Purpose: Validate the service readiness response at the shared HTTP boundary.
// Pattern: Feature schema and timeout on the common Axios transport.
// Usage: The Home health query passes its cancellation signal.
// Related: shared/api/http.ts, pages/home-page.tsx.
import { z } from 'zod';
import { request } from '@/shared/api/http';

const healthSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('PuPuTyX'),
  version: z.string(),
});

export async function getHealth({ signal }: { signal: AbortSignal }) {
  return request('/healthz', healthSchema, { signal, timeout: 5_000 });
}
