// Purpose: Read/upload passive presentation images through the shared cancellable transport.
// Pattern: Immutable project media, idempotent upload IDs and no arbitrary external URLs.
// Usage: Object tools; local image bytes are bounded by server decoding as well as client size.
// Related: modules/presentations/media.rs, object-tools.tsx.
import { z } from 'zod';
import { request } from '@/shared/api/http';
const media = z.object({ id: z.uuid(), name: z.string(), width: z.number(), height: z.number() });
const base = (p: string) => `/api/v1/projects/${p}/presentation-media`;
export const mediaKey = (p: string) => ['presentation-media', p] as const;
export const listMedia = (p: string, signal: AbortSignal) =>
  request(base(p), z.array(media), { signal });
export const mediaUrl = (p: string, id: string) => `${base(p)}/${id}`;
export const uploadImage = (p: string, key: string, file: File, signal: AbortSignal) =>
  request(`${base(p)}?name=${encodeURIComponent(file.name)}`, media, {
    method: 'POST',
    headers: { 'Idempotency-Key': key, 'Content-Type': file.type || 'application/octet-stream' },
    binaryBody: file,
    signal,
    timeout: 120000,
  });
