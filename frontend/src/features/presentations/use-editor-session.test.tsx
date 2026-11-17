// Purpose: Verify the undo cache ends with editor visits while accepted rendering keeps its session.
// Pattern: Lifecycle tests for async opening, route exit, pagehide and late initialization.
// Usage: Vitest; server TTL/cascade behavior is tested through real SQLite/HTTP tests.
// Related: use-editor-session.ts, history-api.ts, presentation_history.rs.
import { renderHook, waitFor, cleanup, act } from '@testing-library/react';
import { it, expect, vi, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { Run } from './api';
import { useEditorSession } from './use-editor-session';
import { openEditor, closeEditor } from './history-api';
vi.mock('./history-api', () => ({
  openEditor: vi.fn(async (_p: string, _r: string, id: string) => ({ id })),
  touchEditor: vi.fn(async () => ({ ok: true })),
  closeEditor: vi.fn(),
}));
const run: Run = {
  id: 'one',
  presentation_id: 'deck',
  project_id: 'p',
  presentation_version: 1,
  is_current: true,
  title: 'Deck',
  status: 'succeeded',
  stage: 'complete',
  version: 1,
  completed: 1,
  total: 1,
  error_code: null,
  created_at: 0,
};
let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
afterEach(() => {
  cleanup();
  client.clear();
  vi.clearAllMocks();
});
it('retains its cache through rendering, then closes it on editor exit and opens a new visit', async () => {
  client = new QueryClient();
  const { result, rerender } = renderHook(({ active, run }) => useEditorSession('p', run, active), {
    wrapper,
    initialProps: { active: true, run },
  });
  await waitFor(() => expect(result.current.id).toBeTruthy());
  const id = result.current.id;
  rerender({ active: true, run: { ...run, id: 'two', status: 'queued', stage: 'rendering' } });
  expect(result.current.id).toBe(id);
  expect(closeEditor).not.toHaveBeenCalled();
  rerender({ active: false, run });
  expect(result.current.id).toBeNull();
  expect(closeEditor).toHaveBeenCalledWith('p', id, false);
  rerender({ active: true, run });
  await waitFor(() => expect(result.current.id).toBeTruthy());
  expect(result.current.id).not.toBe(id);
});
it('sends pagehide cleanup and does not revive a late opening response after unmount', async () => {
  client = new QueryClient();
  const { result, unmount } = renderHook(() => useEditorSession('p', run, true), { wrapper });
  await waitFor(() => expect(result.current.id).toBeTruthy());
  const id = result.current.id;
  act(() => window.dispatchEvent(new Event('pagehide')));
  expect(result.current.id).toBeNull();
  expect(closeEditor).toHaveBeenCalledWith('p', id, true);
  unmount();
  let resolve: ((v: { id: string }) => void) | undefined;
  vi.mocked(openEditor).mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const next = renderHook(() => useEditorSession('p', run, true), { wrapper });
  const lateId = vi.mocked(openEditor).mock.calls.at(-1)?.[2];
  next.unmount();
  await act(async () => {
    resolve?.({ id: lateId ?? '' });
  });
  expect(closeEditor).toHaveBeenCalledWith('p', lateId);
});
