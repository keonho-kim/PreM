// Purpose: Present committed execution checkpoints without exposing implementation identifiers.
// Pattern: Read-only status rows; feature owners supply labels and keep commands/errors.
// Usage: Search and conversation workflows; shadcn controls own interactive behavior.
// Related: related-documents, presentations, workflow-stages.css.
import { Check, Clock3, Minus, TriangleAlert } from 'lucide-react';
import './workflow-stages.css';
export type WorkflowStage = { key: string; state: string; attempt: number };
export function WorkflowStages({
  steps,
  labels,
  name,
  status,
}: {
  steps?: WorkflowStage[];
  labels: Record<string, string>;
  name: string;
  status: string;
}) {
  if (!steps?.length) return null;
  return (
    <ol className="workflow-stages" aria-label={name}>
      {steps.map((s) => {
        const state =
          s.state === 'succeeded'
            ? '완료'
            : s.state === 'failed'
              ? '확인 필요'
              : s.state === 'running'
                ? '진행 중'
                : s.state === 'cancelled' || status === 'cancelled'
                  ? '중단'
                  : '대기';
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
            <span>{labels[s.key] ?? '자료 준비'}</span>
            <span className="field-hint">{state}</span>
          </li>
        );
      })}
    </ol>
  );
}
