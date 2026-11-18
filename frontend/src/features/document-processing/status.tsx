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
  const percent = measured ? Math.min(100, (job.completed_blocks / job.total_blocks) * 100) : null;
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
                  : step.state === 'failed' || (step.state === 'running' && job.status === 'failed')
                    ? TriangleAlert
                    : step.state === 'running'
                      ? Clock3
                      : Minus;
              const label =
                step.state === 'succeeded'
                  ? '완료'
                  : step.state === 'failed' || (step.state === 'running' && job.status === 'failed')
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
      {percent !== null && (
        <>
          <p>
            본문 {job.completed_blocks} / {job.total_blocks}개 정리 · {Math.floor(percent)}%
          </p>
          <Progress aria-label="내용 정리 진행률" value={percent} />
        </>
      )}
      {(job.status === 'extracting' || (job.status === 'classifying' && !measured)) && (
        <Progress
          aria-label={job.status === 'extracting' ? '문서 읽기 진행 중' : '내용 정리 진행 중'}
          value={null}
        />
      )}
      {(job.status === 'failed' || (job.status === 'queued' && job.error_code)) && (
        <>
          <p>{failureReason(job.error_code)}</p>
          {job.status === 'queued' && <p>자동 재시도를 기다리고 있습니다.</p>}
          <details className="field-hint">
            <summary>작업 상세</summary>
            <p>
              작업 ID <code>{job.id}</code>
              <br />
              오류 코드 <code>{job.error_code ?? 'processing_failed'}</code>
              <br />
              시도 {job.attempt}회 · {new Date(job.updated_at).toLocaleString('ko-KR')}
            </p>
          </details>
        </>
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
export function stepSummary(job: Job) {
  if (!job.steps?.length) return processingLabel(job.status, job.kind === 'templates');
  const current =
    job.steps?.find((s) => s.state === 'running' || s.state === 'failed') ??
    job.steps?.find((s) => s.state !== 'succeeded');
  return current
    ? `${(job.steps?.indexOf(current) ?? 0) + 1}/${job.steps?.length}단계 · ${stepName(current.key, job.kind === 'templates')} · ${job.status === 'waiting_configuration' ? '설정 대기' : job.status === 'cancelled' ? '취소됨' : job.status === 'failed' ? '다시 확인' : job.status === 'queued' ? '대기' : current.state === 'running' ? '진행 중' : '대기'}`
    : '모든 준비를 마쳤습니다.';
}

function failureReason(code: string | null) {
  switch (code) {
    case 'runtime_missing':
    case 'template_runtime_missing':
      return '서버에서 문서 처리 도구를 실행할 수 없습니다. 도구 설치 후 다시 시도하세요.';
    case 'storage_unavailable':
      return '처리 결과를 저장하지 못했습니다. 서버 저장소 상태를 확인한 뒤 다시 시도하세요.';
    case 'document_step_timeout':
      return '문서 읽기 또는 자료 준비 단계가 제한 시간(30분)을 넘겼습니다. 다시 시도하거나 파일을 나누어 등록해 보세요.';
    case 'extraction_timeout':
      return '문서 읽기가 제한 시간(3분)을 넘겼습니다. 파일을 나누어 등록해 보세요.';
    case 'ocr_failed':
      return '이미지의 글자를 읽지 못했습니다. OCR 모델 설치와 원본 화질을 확인하세요.';
    case 'page_limit':
      return '500페이지를 초과했습니다. 문서를 나누어 등록하세요.';
    case 'extraction_limit':
      return '추출 결과가 처리 한도를 넘겼습니다. 문서를 나누어 등록하세요.';
    case 'incomplete_extraction':
      return '일부 본문이나 표를 끝까지 읽지 못했습니다. 원본을 확인하세요.';
    case 'profile_unavailable':
      return '처리 도구 버전이 바뀌었습니다. 다시 시도하면 현재 도구로 새 작업을 시작합니다.';
    case 'provider_timeout':
    case 'provider_unreachable':
      return '모델 서버의 응답을 받지 못했습니다. 연결을 확인하세요.';
    case 'workflow_incompatible':
      return '현재 서버에서 이어서 준비할 수 없는 자료입니다. 관리자에게 확인해 주세요.';
    case 'extract_failed':
    case 'invalid_package':
      return '문서 처리 도구가 파일을 읽지 못했습니다. 원본 파일이 정상적으로 열리는지 확인하세요.';
    default:
      return '작업을 마치지 못했습니다. 원본은 보관되어 있습니다. 작업 상세에서 오류를 확인하세요.';
  }
}
