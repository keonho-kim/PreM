// Purpose: Show understandable preparation states without internal diagnostics.
// Pattern: Measured progress only; detailed error codes remain in persisted job history.
// Usage: Space cards, asset previews and initiating-tab upload rows.
// Related: api.ts, processing-dialog.tsx, shared shadcn Progress.
import { Progress } from '@/components/ui/progress';
import type { Job } from './api';
export function processingLabel(status: string, template = false): string {
  return (
    {
      not_started: '미리보기 준비 전',
      queued: '준비 대기 중',
      extracting: template ? '템플릿 준비 중' : '자료 준비 중',
      classifying: '자료 정리 중',
      waiting_configuration: '자료 준비가 잠시 대기 중입니다',
      succeeded: template ? '템플릿 준비 완료' : '자료 준비 완료',
      failed: '자료를 준비하지 못했습니다',
      cancelled: '취소됨',
    }[status] ?? '자료 준비 중'
  );
}
export function ProcessingStatus({ job }: { job: Job }) {
  const measured = job.status === 'classifying' && job.total_blocks > 0;
  return (
    <div className="processing-status" data-complete={job.status === 'succeeded'}>
      <p role="status">{processingLabel(job.status, job.kind === 'templates')}</p>
      {measured && (
        <Progress
          aria-label="자료 준비 진행률"
          value={(job.completed_blocks / job.total_blocks) * 100}
        />
      )}
      {job.status === 'failed' && (
        <p className="field-hint">원본 파일은 안전하게 보관되어 있습니다. 다시 시도해 주세요.</p>
      )}
      {job.status === 'waiting_configuration' && (
        <p className="field-hint">먼저 준비된 내용은 아래에서 확인할 수 있습니다.</p>
      )}
    </div>
  );
}
