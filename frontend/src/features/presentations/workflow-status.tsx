// Purpose: Show committed PPT execution steps in office language without invented percentages.
// Pattern: Read-only ordered status list; errors and cancellation remain visible beside real commands.
// Usage: Generation displays actual server node checkpoints while a job is in progress.
// Related: api.ts, workflows/definitions/, workflow-status.css.
import { Check, Minus, Clock3, TriangleAlert } from 'lucide-react';
import type { Run } from './api';
import './workflow-status.css';
const names: Record<string, string> = {
  write: '내용 작성',
  render: '파일 생성·검사',
  publish: '결과 저장',
};
export function WorkflowStatus({ run }: { run: Run }) {
  if (!run.steps?.length) return null;
  return (
    <ol className="presentation-workflow-status" aria-label="발표자료 처리 단계">
      {run.steps.map((s) => {
        const state =
          s.state === 'succeeded'
            ? '완료'
            : s.state === 'failed'
              ? '확인 필요'
              : s.state === 'cancelled'
                ? '중단'
                : s.state === 'running'
                  ? '진행 중'
                  : run.status === 'cancelled'
                    ? '중단'
                    : run.status === 'failed'
                      ? '대기'
                      : '준비';
        const Icon =
          s.state === 'succeeded'
            ? Check
            : s.state === 'failed'
              ? TriangleAlert
              : s.state === 'running'
                ? Clock3
                : Minus;
        return (
          <li key={s.key} aria-current={s.state === 'running' ? 'step' : undefined}>
            <Icon aria-hidden="true" />
            <span>{names[s.key] ?? '처리 단계'}</span>
            <span className="field-hint">{state}</span>
          </li>
        );
      })}
    </ol>
  );
}
