// Purpose: Own disposable undo-cache lifetime for one browser's editor visit.
// Pattern: Memory-only ID, explicit close/beacon, abortable heartbeat and server idle expiration.
// Usage: Mounted per project/deck; leaving the editor ends its cache, not durable PPT revisions.
// Related: history-api.ts, presentations/sessions.rs, V22 migration.
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { openEditor, touchEditor, closeEditor } from './history-api';
import type { Run } from './api';
export function useEditorSession(project: string, run: Run, active: boolean) {
  const scope = `${project}:${run.presentation_id}`,
    latest = useRef(run.id);
  latest.current = run.id;
  const client = useQueryClient();
  const [attempt, setAttempt] = useState(0),
    [state, setState] = useState<{
      scope: string;
      attempt: number;
      id: string | null;
      error: unknown;
    }>({ scope: '', attempt: 0, id: null, error: null });
  const eligible =
    active &&
    (run.status === 'succeeded' ||
      (state.scope === scope && state.attempt === attempt && !!state.id));
  useEffect(() => {
    if (!eligible) return;
    const id = crypto.randomUUID(),
      controller = new AbortController();
    let closed = false,
      opened = false;
    const clear = () => {
      setState((s) => (s.id === id ? { ...s, id: null } : s));
      client.removeQueries({
        queryKey: ['presentation-history', project],
        predicate: (q) => q.queryKey[3] === id,
      });
    };
    const end = (beacon = false) => {
      if (closed) return;
      closed = true;
      controller.abort();
      closeEditor(project, id, beacon);
      clear();
    };
    void openEditor(project, latest.current, id, controller.signal)
      .then(() => {
        if (closed) {
          closeEditor(project, id);
          return;
        }
        opened = true;
        setState({ scope, attempt, id, error: null });
      })
      .catch((error) => {
        if (!closed) setState({ scope, attempt, id: null, error });
      });
    const timer = window.setInterval(() => {
      if (!opened || closed) return;
      void touchEditor(project, id, controller.signal).catch((error) => {
        if (!closed) {
          end();
          setState({ scope, attempt, id: null, error });
        }
      });
    }, 60000);
    const leave = () => end(true),
      show = (event: PageTransitionEvent) => {
        if (event.persisted) setAttempt((n) => n + 1);
      };
    window.addEventListener('pagehide', leave);
    window.addEventListener('pageshow', show);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('pagehide', leave);
      window.removeEventListener('pageshow', show);
      end();
    };
  }, [eligible, project, scope, attempt, client]);
  const current = state.scope === scope && state.attempt === attempt;
  return {
    id: eligible && current ? state.id : null,
    error: current ? state.error : null,
    retry: () => setAttempt((n) => n + 1),
  };
}
