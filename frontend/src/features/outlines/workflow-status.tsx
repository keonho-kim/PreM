// Purpose: Show committed outline/mapping steps and measured content work without total-time estimates.
// Pattern: Office-language status; final saving is distinct from completed model batches.
// Usage: Studio generation controls preserve manual drafts and never move focus on completion.
// Related: generation.tsx, api.ts, workflows/definitions/.
import { Check, Clock3, Minus, TriangleAlert } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import type { Run } from './api';
import './workflow-status.css';
export function WorkflowStatus({ run }: { run: Run }) {
  const working = run.steps?.find((step) => ['compose', 'map'].includes(step.key));
  const measured = run.status === 'running' && run.total > 0 && working?.state !== 'succeeded';
  return (
    <div className="outline-workflow-status">
      {!!run.steps?.length && (
        <ol aria-label="목차·내용 처리 단계">
          {run.steps.map((step) => {
            const state =
              step.state === 'succeeded'
                ? '완료'
                : step.state === 'failed'
                  ? '확인 필요'
                  : step.state === 'running'
                    ? '진행 중'
                    : step.state === 'cancelled' || run.status === 'cancelled'
                      ? '중단'
                      : '대기';
            const Icon =
              step.state === 'succeeded'
                ? Check
                : step.state === 'failed'
                  ? TriangleAlert
                  : step.state === 'running'
                    ? Clock3
                    : Minus;
            return (
              <li key={step.key} aria-current={step.state === 'running' ? 'step' : undefined}>
                <Icon aria-hidden="true" />
                <span>
                  {step.key === 'compose'
                    ? '목차 구성'
                    : step.key === 'map'
                      ? '내용 연결'
                      : '결과 저장'}
                </span>
                <span className="field-hint">{state}</span>
              </li>
            );
          })}
        </ol>
      )}
      {measured && (
        <>
          <p className="field-hint">
            {run.completed} / {run.total}개 묶음 완료
          </p>
          <Progress
            aria-label={run.kind === 'map' ? '내용 연결 진행률' : '목차 구성 진행률'}
            value={(run.completed / run.total) * 100}
          />
        </>
      )}
      {run.status === 'succeeded' && (
        <p role="status">자동 구성을 마쳤습니다. 연결된 원문을 확인하세요.</p>
      )}
    </div>
  );
}
