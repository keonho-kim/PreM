// Purpose: Follow real preparation stages for uploads initiated by this browser tab.
// Pattern: Query owns shared processing; explicit controls own idempotent cancel/retry commands.
// Usage: Space/Studio upload rows; dismissing this local panel never cancels server work.
// Related: status.tsx, api.ts, features/space/upload-panel.tsx.
import { useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/shared/api/http';
import { getDetail, processingKeys, terminal, command, type Job } from './api';
import { ProcessingStatus } from './status';
export function UploadProcessing({ kind, id }: { kind: string; id: string }) {
  const cache = useQueryClient(),
    receipt = useRef<{ stamp: string; key: string } | null>(null);
  const result = useQuery({
    queryKey: processingKeys.detail(kind, id),
    queryFn: ({ signal }) => getDetail(kind, id, undefined, signal),
    retry: false,
    refetchInterval: (q) => (q.state.data && terminal(q.state.data.job.status) ? false : 2000),
  });
  const update = useMutation({
    mutationFn: ({ job, action }: { job: Job; action: 'retry' | 'cancel' }) => {
      const stamp = `${job.id}:${job.version}:${action}`;
      if (receipt.current?.stamp !== stamp) receipt.current = { stamp, key: crypto.randomUUID() };
      return command(job, action, receipt.current.key);
    },
    retry: false,
    onError: () => {
      void result.refetch();
    },
    onSuccess: () => {
      receipt.current = null;
      void cache.invalidateQueries({ queryKey: processingKeys.all });
      void cache.invalidateQueries({ queryKey: ['space'] });
      void cache.invalidateQueries({ queryKey: ['studio'] });
    },
  });
  const job = result.data?.job;
  return (
    <div className="upload-preparation">
      {job ? (
        <>
          <ProcessingStatus job={job} compact />
          {job.status !== 'succeeded' && (
            <Button
              variant="ghost"
              disabled={update.isPending}
              onClick={() =>
                update.mutate({ job, action: terminal(job.status) ? 'retry' : 'cancel' })
              }
            >
              {terminal(job.status) ? '자료 준비 다시 시도' : '자료 준비 취소'}
            </Button>
          )}
        </>
      ) : result.isError ? (
        <p role="status">
          처리 상태를 불러오지 못했습니다.{' '}
          <Button variant="ghost" onClick={() => void result.refetch()}>
            다시 확인
          </Button>
        </p>
      ) : (
        <p className="field-hint" role="status">
          처리 상태 확인 중
        </p>
      )}
      {update.isError && <p role="alert">{errorMessage(update.error)}</p>}
    </div>
  );
}
