// Purpose: Show understandable preparation states without internal diagnostics.
// Pattern: Measured progress only; detailed error codes remain in persisted job history.
// Usage: Space cards, asset previews and initiating-tab upload rows.
// Related: api.ts, processing-dialog.tsx, shared shadcn Progress.
import { Check, Clock3, Minus, TriangleAlert } from 'lucide-react';
import './processing-stages.css';
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
export function ProcessingStatus({ job, compact = false }: { job: Job; compact?: boolean }) {
  const measured = job.status === 'classifying' && job.total_blocks > 0;
  return (
    <div className="processing-status" data-complete={job.status === 'succeeded'}>
      <p role="status">{processingLabel(job.status, job.kind === 'templates')}</p>
      {!!job.steps?.length &&
        (compact ? (
          <p className="field-hint">{stepSummary(job)}</p>
        ) : (
          <ol className="processing-stages" aria-label="자료 준비 단계">
            {job.steps.map((step) => {
              const Icon =
                step.state === 'succeeded'
                  ? Check
                  : step.state === 'failed'
                    ? TriangleAlert
                    : step.state === 'running'
                      ? Clock3
                      : Minus;
              const label =
                step.state === 'succeeded'
                  ? '완료'
                  : step.state === 'failed'
                    ? '확인 필요'
                    : step.state === 'cancelled' || job.status === 'cancelled'
                      ? '취소됨'
                      : step.key === 'classify' && job.status === 'waiting_configuration'
                        ? '설정 대기'
                        : step.state === 'running'
                          ? '진행 중'
                          : '대기';
              return (
                <li key={step.key} aria-current={step.state === 'running' ? 'step' : undefined}>
                  <Icon aria-hidden="true" />
                  <span>{stepName(step.key, job.kind === 'templates')}</span>
                  <span>{label}</span>
                </li>
              );
            })}
          </ol>
        ))}
      {measured && (
        <Progress
          aria-label="내용 정리 진행률"
          value={(job.completed_blocks / job.total_blocks) * 100}
        />
      )}
      {job.status === 'failed' && job.error_code === 'workflow_incompatible' && (
        <p className="field-hint">
          현재 서버에서 이어서 준비할 수 없는 자료입니다. 관리자에게 확인해 주세요.
        </p>
      )}
      {job.status === 'failed' && (
        <p className="field-hint">원본 파일은 안전하게 보관되어 있습니다. 다시 시도해 주세요.</p>
      )}
      {job.status === 'waiting_configuration' && (
        <p className="field-hint">
          Admin의 Decision Model 연결에서 사용할 판정 모델을 설정해야 자료 처리가 시작됩니다.
        </p>
      )}
    </div>
  );
}

function stepName(key: string, template: boolean) {
  return key === 'extract'
    ? template
      ? '템플릿 미리보기 준비'
      : '문서 읽기'
    : key === 'classify'
      ? '내용 정리'
      : key === 'ready'
        ? template
          ? '사용 준비'
          : '검색·작성 준비'
        : '자료 준비';
}
function stepSummary(job: Job) {
  const current =
    job.steps?.find((s) => s.state === 'running' || s.state === 'failed') ??
    job.steps?.find((s) => s.state !== 'succeeded');
  return current
    ? `${stepName(current.key, job.kind === 'templates')} · ${job.status === 'waiting_configuration' ? '설정 대기' : job.status === 'cancelled' ? '취소됨' : job.status === 'failed' ? '다시 확인' : job.status === 'queued' ? '대기' : current.state === 'running' ? '진행 중' : '대기'}`
    : '모든 준비를 마쳤습니다.';
}
