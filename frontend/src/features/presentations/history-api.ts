// Purpose: Read authoritative comparison/undo state and submit conditional restoration commands.
// Pattern: Server-owned three-entry stack, immutable artifacts and idempotent undo receipts.
// Usage: Central editor toolbar; ordinary project API without Admin credentials.
// Related: backend/modules/presentations/history.rs, use-deck-review.ts.
import { z } from 'zod';
import { request } from '@/shared/api/http';
import { runSchema, type Run } from './api';
const history = z.object({
  before_run_id: z.uuid().nullable(),
  slides: z.array(z.object({ slide_id: z.uuid(), before_slide_id: z.uuid() })),
  undo_remaining: z.number().int().min(0).max(3),
});
export const historyKey = (p: string, r: string, session: string | null) =>
  ['presentation-history', p, r, session] as const;
export const getHistory = (p: string, r: string, session: string | null, signal: AbortSignal) =>
  request(
    `/api/v1/projects/${p}/presentations/${r}/history${session ? `?session_id=${session}` : ''}`,
    history,
    { signal },
  );
export const undoDeck = (p: string, r: Run, key: string, session: string) =>
  request(`/api/v1/projects/${p}/presentations/${r.id}/undo`, runSchema, {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: JSON.stringify({ expected_version: r.presentation_version, editor_session_id: session }),
  });
export const editPreviewUrl = (p: string, e: string, s: string) =>
  `/api/v1/projects/${p}/slide-edits/${e}/slides/${s}/preview`;

const sessionUrl = (p: string, id: string) => `/api/v1/projects/${p}/editor-sessions/${id}`;
export const openEditor = (p: string, run: string, id: string, signal: AbortSignal) =>
  request(
    `/api/v1/projects/${p}/presentations/${run}/editor-sessions`,
    z.object({ id: z.uuid() }),
    { method: 'POST', body: JSON.stringify({ session_id: id }), signal },
  );
export const touchEditor = (p: string, id: string, signal: AbortSignal) =>
  request(sessionUrl(p, id), z.object({ ok: z.boolean() }), { method: 'PATCH', signal });
export function closeEditor(p: string, id: string, beacon = false) {
  const url = `${sessionUrl(p, id)}/close`;
  if (beacon && navigator.sendBeacon?.(url)) return;
  void fetch(url, { method: 'POST', keepalive: true }).catch(() => {});
}
