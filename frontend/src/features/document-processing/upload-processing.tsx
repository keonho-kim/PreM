// Purpose: Follow processing only for assets uploaded by this browser tab.
// Pattern: Read-only Query polling; clearing/closing the local panel never cancels shared work.
// Usage: Uppy successful upload rows pass committed asset IDs.
// Related: status.tsx, features/space/upload-panel.tsx.
import { useQuery } from '@tanstack/react-query';
import { getDetail, processingKeys, terminal } from './api';
import { processingLabel } from './status';
export function UploadProcessing({ kind, id }: { kind: string; id: string }) {
  const result = useQuery({
    queryKey: processingKeys.detail(kind, id),
    queryFn: ({ signal }) => getDetail(kind, id, undefined, signal),
    retry: false,
    refetchInterval: (q) => (q.state.data && terminal(q.state.data.job.status) ? false : 2000),
  });
  return (
    <p className="field-hint" role="status">
      {result.data
        ? processingLabel(result.data.job.status, kind === 'templates')
        : result.isError
          ? '처리 상태는 Space에서 확인하세요.'
          : '처리 상태 확인 중'}
    </p>
  );
}
