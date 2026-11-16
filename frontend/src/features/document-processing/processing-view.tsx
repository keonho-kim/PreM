// Purpose: Share version-bound asset content and recovery actions between page and dialog frames.
// Pattern: Query owns canonical state; the calling frame owns navigation and focus.
// Usage: ProcessingDialog and the dedicated document page supply explicit targets.
// Related: template-preview.tsx, content.tsx, api.ts, features/space/space-directory.tsx.
import { useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/shared/api/http';
import { command, enqueue, getDetail, processingKeys, terminal, type Job } from './api';
import { ProcessingStatus } from './status';
import { ExtractedContent } from './content';
import { TemplatePreview } from './template-preview';
import './processing.css';
export type Target = {
  id: string;
  kind: 'references' | 'templates' | `project-${string}`;
  version: number;
  file_version: number;
  title: string;
  job_id?: string;
  page_id?: string;
};
export function ProcessingView({ item, fullPage = false }: { item: Target; fullPage?: boolean }) {
  const Title = fullPage ? 'h1' : DialogTitle;
  const Description = fullPage ? 'p' : DialogDescription;
  const cache = useQueryClient();
  const receipt = useRef<{ stamp: string; key: string } | null>(null);
  const detail = useQuery({
    queryKey: processingKeys.detail(item.kind, item.id, item.job_id),
    queryFn: ({ signal }) => getDetail(item.kind, item.id, item.job_id, signal),
    retry: false,
    refetchOnMount: 'always',
    refetchInterval: (q) => (q.state.data && terminal(q.state.data.job.status) ? 15000 : 2000),
  });
  const noJob = detail.error instanceof ApiError && detail.error.status === 404;
  const mutate = useMutation({
    mutationFn: async ({ action, job }: { action: 'enqueue' | 'retry' | 'cancel'; job?: Job }) => {
      const stamp = `${action}:${job?.id ?? item.id}:${job?.version ?? item.version}`;
      if (receipt.current?.stamp !== stamp) receipt.current = { stamp, key: crypto.randomUUID() };
      return action === 'enqueue'
        ? enqueue(item.kind, item.id, item.version, receipt.current.key)
        : command(job as Job, action, receipt.current.key);
    },
    retry: false,
    onSuccess: () => {
      receipt.current = null;
      void cache.invalidateQueries({ queryKey: processingKeys.all });
      void cache.invalidateQueries({ queryKey: ['space'] });
      void cache.invalidateQueries({ queryKey: ['studio'] });
    },
  });
  const data = detail.data;
  const job = data?.job;
  const template = item.kind === 'templates';
  const missingPreview =
    template && job?.status === 'succeeded' && !data?.template?.previews.length;
  const missingMaterials = !template && job?.extraction_id && !data?.reuse_ready;
  return (
    <>
      <header className="asset-preview-heading">
        <Title tabIndex={fullPage ? -1 : undefined}>{item.title}</Title>
        <Description>
          {template
            ? '템플릿 미리보기'
            : item.kind.startsWith('project-')
              ? '프로젝트 원본'
              : '레퍼런스'}{' '}
          · 버전 {job?.file_version ?? item.file_version}
        </Description>
        <div className="processing-toolbar">
          <Button variant="secondary" asChild>
            <a
              href={`${item.kind.startsWith('project-') ? `/api/v1/projects/${item.kind.slice(8)}/files` : `/api/v1/space/${item.kind}`}/${item.id}/download?version=${job?.file_version ?? item.file_version}`}
            >
              <Download aria-hidden="true" />
              원본 다운로드
            </a>
          </Button>
          {!item.job_id && (noJob || missingPreview || missingMaterials) && (
            <Button
              disabled={mutate.isPending}
              onClick={() => mutate.mutate({ action: 'enqueue' })}
            >
              {missingMaterials ? '재사용 자료 준비' : '미리보기 만들기'}
            </Button>
          )}
          {!item.job_id && job && ['failed', 'cancelled'].includes(job.status) && (
            <Button
              disabled={mutate.isPending}
              onClick={() =>
                mutate.mutate({
                  action: job.error_code === 'profile_unavailable' ? 'enqueue' : 'retry',
                  job,
                })
              }
            >
              다시 시도
            </Button>
          )}
          {!item.job_id && job && !terminal(job.status) && (
            <Button
              variant="ghost"
              disabled={mutate.isPending}
              onClick={() => mutate.mutate({ action: 'cancel', job })}
            >
              취소
            </Button>
          )}
        </div>
      </header>
      <div className="asset-preview-body">
        {mutate.isError && (
          <p role="alert">요청을 완료하지 못했습니다. 자료를 다시 열어 확인해 주세요.</p>
        )}
        {detail.isPending ? (
          <p role="status">자료를 불러오고 있습니다.</p>
        ) : detail.isError && !noJob ? (
          <div role="status">
            <p>자료를 불러오지 못했습니다.</p>
            <Button variant="secondary" onClick={() => void detail.refetch()}>
              다시 시도
            </Button>
          </div>
        ) : noJob ? (
          <p>미리보기를 준비해 주세요. 원본 파일은 그대로 유지됩니다.</p>
        ) : (
          data && (
            <>
              <ProcessingStatus job={data.job} />
              {template
                ? data.template && <TemplatePreview key={data.job.id} detail={data} />
                : data.job.extraction_id && (
                    <ExtractedContent
                      key={data.job.id}
                      detail={data}
                      initialPage={item.page_id}
                      searchable={!fullPage}
                    />
                  )}
            </>
          )
        )}
      </div>
    </>
  );
}
