// Purpose: Own cancellable discovery for the exact unsaved credential draft.
// Pattern: Component-local results, reference-matched inputs and no credential query cache.
// Usage: ProviderForm invalidates model choices immediately when connection inputs change.
// Related: api.ts, model-picker.tsx, provider-form.tsx.
import { useEffect, useMemo, useRef, useState } from 'react';
import { discoverModels, type DiscoveryInput } from './api';
export function useModelDiscovery(values: DiscoveryInput) {
  const { connection_id, expected_version, provider_type, base_url, api_key, clear_secret } =
    values;
  const input = useMemo(
    () => ({ connection_id, expected_version, provider_type, base_url, api_key, clear_secret }),
    [connection_id, expected_version, provider_type, base_url, api_key, clear_secret],
  );
  const controller = useRef<AbortController | null>(null);
  const [result, setResult] = useState<{ input: DiscoveryInput; models: string[] } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  useEffect(() => {
    setResult((current) => (current?.input === input ? current : null));
    setError(null);
    setPending(false);
    setCancelled(false);
    return () => {
      controller.current?.abort();
      controller.current = null;
    };
  }, [input]);
  const cancel = () => {
    controller.current?.abort();
    controller.current = null;
    setPending(false);
    setCancelled(true);
  };
  const load = async () => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setPending(true);
    setError(null);
    setResult(null);
    setCancelled(false);
    try {
      const models = await discoverModels(input, request.signal);
      if (!request.signal.aborted && controller.current === request) setResult({ input, models });
    } catch (error) {
      if (!request.signal.aborted && controller.current === request) setError(error);
    } finally {
      if (controller.current === request) {
        controller.current = null;
        setPending(false);
      }
    }
  };
  const reset = () => {
    cancel();
    setCancelled(false);
    setResult(null);
    setError(null);
  };
  return {
    reset,
    models: result?.input === input ? result.models : null,
    error,
    pending,
    cancelled,
    load,
    cancel,
  };
}
