// Purpose: Bind a successful probe to the exact editable draft and discard late responses.
// Pattern: Tab-local receipt with explicit cancellation; credentials never enter a query cache.
// Usage: Thinking changes probe the model; other edits require a fresh save-time diagnostic.
// Related: use-provider-form.ts, api.ts, provider_drafts.rs.
import { useCallback, useEffect, useRef, useState } from 'react';
import { probeProvider, type DraftDiagnostic } from '../api';
import { ApiError, errorMessage } from '@/shared/api/http';
export function useDraftDiagnostic(id: string, body: string, timeout: number, ready: boolean) {
  const [state, setState] = useState<{
    body: string;
    result?: DraftDiagnostic;
    error?: string;
    pending?: boolean;
    conflict?: boolean;
  }>();
  const controller = useRef<AbortController | null>(null);
  const run = useCallback(async () => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setState({ body, pending: true });
    try {
      const result = await probeProvider(id, body, request.signal, (timeout + 605) * 8000);
      if (!request.signal.aborted) setState({ body, result });
    } catch (error) {
      if (!request.signal.aborted)
        setState({
          body,
          error: errorMessage(error),
          conflict: error instanceof ApiError && error.code === 'revision_conflict',
        });
    }
  }, [body, id, timeout]);
  const probeAfterEdit = useRef(false);
  useEffect(() => {
    const automatic = probeAfterEdit.current;
    probeAfterEdit.current = false;
    setState(undefined);
    if (automatic && ready) void run();
    return () => controller.current?.abort();
  }, [ready, run]);
  useEffect(() => {
    if (!state?.result?.ticket) return;
    const timer = setTimeout(() => setState(undefined), 14 * 60_000);
    return () => clearTimeout(timer);
  }, [state]);
  const current = state?.body === body ? state : undefined;
  return {
    run,
    onThinkingEdit: () => {
      probeAfterEdit.current = true;
    },
    result: current?.result,
    conflict: current?.conflict,
    error: current?.error,
    pending: current?.pending,
    cancel: () => {
      controller.current?.abort();
      setState(undefined);
    },
  };
}
