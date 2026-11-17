// Purpose: Compose evidence review, template selection and real presentation generation in Studio.
// Pattern: Step visibility preserves generation drafts while preparation remains Query-owned.
// Usage: StudioWorkspace supplies server state and explicit step transitions.
// Related: features/presentations/, features/related-documents/, stepper.tsx.
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { presentationKeys } from '@/features/presentations';
import type { UseQueryResult } from '@tanstack/react-query';
import { RelatedDocuments } from '@/features/related-documents';
import {
  EvidenceConfirmation,
  BlankForm,
  TemplateChoice,
  PresentationGeneration,
  type getPreparation,
} from '@/features/presentations';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/shared/api/http';
import type { StudioStep } from './stepper';
export function PresentationStages({
  project,
  name,
  step,
  preparation,
  ready,
  editable,
  onContinue,
  blank = false,
}: {
  project: string;
  name: string;
  step: StudioStep;
  preparation: UseQueryResult<Awaited<ReturnType<typeof getPreparation>>>;
  ready: boolean;
  editable: boolean;
  onContinue: (step: StudioStep) => void;
  blank?: boolean;
}) {
  const client = useQueryClient();
  const [started, setStarted] = useState(false);
  const active = ['evidence', 'template', 'generation'].includes(step);
  const state = preparation.data;
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!['evidence', 'template', 'generation'].includes(step) || preparation.isPending) return;
    const heading = root.current?.querySelector<HTMLHeadingElement>('h2');
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
      heading.scrollIntoView({ block: 'center', behavior: 'instant' });
    }
  }, [step, preparation.isPending]);
  return (
    <div ref={root} className="presentation-stages">
      {step === 'evidence' && (
        <RelatedDocuments project={project} ready={ready} editable={editable} />
      )}
      {active && preparation.isPending && <p role="status">발표 준비 상태를 확인합니다.</p>}
      {active && preparation.isError && (
        <p role="alert">
          {errorMessage(preparation.error)}{' '}
          <Button variant="secondary" onClick={() => void preparation.refetch()}>
            다시 확인
          </Button>
        </p>
      )}
      {state && (
        <>
          {step === 'evidence' && (
            <EvidenceConfirmation
              project={project}
              state={state}
              editable={editable}
              onContinue={() => onContinue('template')}
            />
          )}
          {step === 'template' && (
            <TemplateChoice
              project={project}
              state={state}
              editable={editable}
              onContinue={() => onContinue('generation')}
            />
          )}
          <div hidden={step !== 'generation'}>
            {blank && !started ? (
              <BlankForm
                project={project}
                name={name}
                template={state.template_job_id}
                editable={editable}
                active={step === 'generation'}
                busy={false}
                onCreated={() => {
                  setStarted(true);
                  void client.invalidateQueries({ queryKey: presentationKeys.all });
                }}
              />
            ) : (
              <PresentationGeneration
                project={project}
                name={name}
                state={state}
                editable={editable}
                active={step === 'generation'}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
