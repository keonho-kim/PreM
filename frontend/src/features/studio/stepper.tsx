// Purpose: Show explicit saved-input progress through implemented Studio authoring stages.
// Pattern: Connected circular markers; visits do not complete steps and dirty drafts cannot advance.
// Usage: StudioWorkspace supplies current review/guide/outline facts and route transitions.
// Related: studio-workspace.tsx, studio.css, features/outlines/.
import { useStudioChrome } from './use-studio-chrome';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
export type StudioStep = 'sources' | 'guide' | 'outline' | 'evidence' | 'template' | 'generation';
export function StudioStepper({
  step,
  source,
  guide,
  outline,
  dirty,
  unsavedOutline = false,
  evidence = false,
  template = false,
  generated = false,
  onSelect,
}: {
  step: StudioStep;
  source: boolean;
  guide: boolean;
  outline: boolean;
  dirty: boolean;
  unsavedOutline?: boolean;
  evidence?: boolean;
  template?: boolean;
  generated?: boolean;
  onSelect: (step: StudioStep) => void;
}) {
  const chrome = useStudioChrome();
  const done = [source, guide, outline, evidence, template, generated],
    current = ['sources', 'guide', 'outline', 'evidence', 'template', 'generation'].indexOf(step);
  return (
    <nav ref={chrome} className="studio-stepper" aria-label="PPT 제작 단계">
      <ol className="studio-steps">
        {['원본 등록', '작성 방향', '목차·내용', '근거', '템플릿', '생성·편집'].map((label, i) => (
          <li
            key={label}
            className={`${done[i] ? 'is-done ' : ''}${done[i] && done[i + 1] ? 'is-connected' : ''}`}
          >
            <Button
              variant="ghost"
              type="button"
              disabled={
                (i === 4 && !evidence) ||
                (i === 5 && !template) ||
                (i > 0 && !source && i !== current) ||
                (dirty && i !== current) ||
                (i >= 3 && unsavedOutline)
              }
              aria-label={label}
              aria-current={i === current ? 'step' : undefined}
              onClick={() =>
                onSelect(
                  (['sources', 'guide', 'outline', 'evidence', 'template', 'generation'] as const)[
                    i
                  ] ?? 'sources',
                )
              }
            >
              <span className="studio-step-marker">{done[i] ? <Check size={18} /> : i + 1}</span>
              <span className="studio-step-label">{label}</span>
              <span className="studio-step-short" aria-hidden="true">
                {['원본', '방향', '목차', '근거', '템플릿', '생성'][i]}
              </span>
            </Button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
