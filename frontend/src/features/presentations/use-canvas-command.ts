// Purpose: Persist one direct canvas gesture and keep the current artwork until rendering succeeds.
// Pattern: Idempotent scoped mutation, real job polling and no automatic replay after conflicts.
// Usage: DeckPreview shares this command owner with canvas controls and slide actions.
// Related: canvas-api.ts, generation.tsx, use-editor-session.ts.
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '@/shared/api/http';
import { applyCanvas, type CanvasOperation } from './canvas-api';
import { listRuns, presentationKeys, type Run } from './api';
export function useCanvasCommand(
  project: string,
  run: Run,
  session: string | null,
  active: boolean,
  onResult: (id: string) => void,
) {
  const [pending, setPending] = useState<string | null>(null),
    [failure, setFailure] = useState('');
  const client = useQueryClient(),
    receipt = useRef<{ stamp: string; key: string } | null>(null),
    visible = useRef(active);
  useEffect(() => {
    visible.current = active;
    return () => {
      visible.current = false;
    };
  }, [active]);
  const jobs = useQuery({
    queryKey: presentationKeys.runs(project),
    queryFn: ({ signal }) => listRuns(project, signal),
    enabled: active && !!pending,
    refetchInterval: active && pending ? 500 : false,
  });
  const command = useMutation({
    mutationFn: ({ slide, operation }: { slide: string; operation: CanvasOperation }) => {
      const input = {
          expected_version: run.presentation_version,
          slide_id: slide,
          session,
          operation,
        },
        stamp = JSON.stringify([project, run.id, input]);
      if (receipt.current?.stamp !== stamp) receipt.current = { stamp, key: crypto.randomUUID() };
      return applyCanvas(project, run.id, receipt.current.key, input);
    },
    retry: false,
    onMutate: () => {
      setFailure('');
      onResult(run.id);
    },
    onSuccess: (r) => {
      receipt.current = null;
      if (visible.current) setPending(r.id);
      void client.invalidateQueries({ queryKey: presentationKeys.runs(project) });
    },
    onError: (e) => {
      if (visible.current) setFailure(errorMessage(e));
      void client.invalidateQueries({ queryKey: presentationKeys.all });
    },
  });
  const job = jobs.data?.find((r) => r.id === pending);
  useEffect(() => {
    if (!active || !pending || !job) return;
    if (job.status === 'succeeded') {
      setPending(null);
      void client.invalidateQueries({ queryKey: ['presentation-history'] });
      onResult(job.id);
    } else if (job.status === 'failed' || job.status === 'cancelled') {
      setFailure(
        '배치를 적용하지 못했습니다. 이전 장표는 유지했습니다. 생성 이력에서 작업을 확인할 수 있습니다.',
      );
      setPending(null);
    }
  }, [active, pending, job, client, onResult]);
  return {
    busy: command.isPending || !!pending,
    error: failure,
    pendingJob: pending,
    apply: (slide: string, operation: CanvasOperation) => command.mutate({ slide, operation }),
  };
}
