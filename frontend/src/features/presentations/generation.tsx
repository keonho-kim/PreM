// Purpose: Compose inline presentation creation, durable history and the slide workbench.
// Pattern: Query owns jobs; inline forms preserve drafts and the current deck leads the page.
// Usage: Studio generation step; existing persistence and model commands remain explicit.
// Related: generation-form.tsx, deck-preview.tsx, api.ts.
import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PresentationHeader } from './presentation-header';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/shared/api/http';
import { listRuns, controlRun, presentationKeys, type Preparation, type Run } from './api';
import { DeckPreview } from './deck-preview';
import { QualityStatus } from './quality-status';
import { WorkflowStatus } from './workflow-status';
import { GenerationForm } from './generation-form';
export function Generation({
  project,
  name,
  state,
  editable,
  active,
}: {
  project: string;
  name: string;
  state: Preparation;
  editable: boolean;
  active: boolean;
}) {
  const [base, setBase] = useState<Run | null>(null),
    [selected, setSelected] = useState('');
  const client = useQueryClient(),
    receipt = useRef<{ stamp: string; key: string } | null>(null),
    created = useRef<string | null>(null),
    outputHeading = useRef<HTMLHeadingElement>(null);
  const history = useQuery({
    queryKey: presentationKeys.runs(project),
    queryFn: ({ signal }) => listRuns(project, signal),
    enabled: active,
    refetchInterval: active ? 2000 : false,
  });
  const working = history.data?.find((r) => ['queued', 'running'].includes(r.status));
  const run = history.data?.find((r) => r.id === selected) ?? history.data?.[0];
  useEffect(() => {
    if (active && run && created.current === run.id) {
      created.current = null;
      outputHeading.current?.focus();
    }
  }, [active, run]);
  const onCreated = (r: Run) => {
    created.current = r.id;
    setBase(null);
    setSelected(r.id);
    client.setQueryData<Run[]>(presentationKeys.runs(project), (rows) => [
      r,
      ...(rows ?? []).filter((v) => v.id !== r.id),
    ]);
    void client.invalidateQueries({ queryKey: presentationKeys.all });
  };
  const refresh = () => void client.invalidateQueries({ queryKey: presentationKeys.all });
  const command = useMutation({
    mutationFn: ({ run, action }: { run: Run; action: 'cancel' | 'retry' }) => {
      const stamp = `${run.id}:${run.version}:${action}`;
      if (receipt.current?.stamp !== stamp) receipt.current = { stamp, key: crypto.randomUUID() };
      return controlRun(project, run, action, receipt.current.key);
    },
    retry: false,
    onSuccess: () => {
      receipt.current = null;
      refresh();
    },
    onError: refresh,
  });
  return (
    <section className="presentation-step" aria-label="PPT 생성">
      {!run && (
        <header className="presentation-heading">
          <div>
            <h2>발표자료를 만들어보세요</h2>
            <p className="muted">슬라이드를 확인하고 내용·메모와 참고 자료를 함께 검토하세요.</p>
          </div>
        </header>
      )}
      {run && (
        <PresentationHeader
          project={project}
          run={run}
          history={history.data ?? []}
          titleRef={outputHeading}
          canCreate={editable && !working}
          onCreate={() => setBase(run)}
          onSelect={setSelected}
        />
      )}
      {history.isError && (
        <p role="alert">
          {errorMessage(history.error)}{' '}
          <Button variant="secondary" onClick={() => void history.refetch()}>
            다시 불러오기
          </Button>
        </p>
      )}
      {history.isPending && <p role="status">발표자료를 불러옵니다.</p>}
      {run && (
        <>
          {run.status !== 'succeeded' && (
            <div className="presentation-run-status">
              <p role="status">{status(run)}</p>
              {['queued', 'running'].includes(run.status) ? (
                <Button
                  variant="secondary"
                  disabled={!editable || command.isPending}
                  onClick={() => command.mutate({ run, action: 'cancel' })}
                >
                  생성 취소
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  disabled={!editable || command.isPending || !!working}
                  onClick={() => command.mutate({ run, action: 'retry' })}
                >
                  이어서 만들기
                </Button>
              )}
            </div>
          )}
          {run.status !== 'succeeded' && <WorkflowStatus run={run} />}
          {(run.status !== 'succeeded' ||
            run.quality?.some((row) => !row.report.passed || row.report.issues.length > 0)) && (
            <QualityStatus rows={run.quality} />
          )}
          <DeckPreview
            key={run.presentation_id}
            project={project}
            run={run}
            active={active}
            canEdit={editable && !working}
            onResult={(id) => {
              setSelected(id);
              refresh();
            }}
          />
        </>
      )}
      {command.isError && <p role="alert">{errorMessage(command.error)}</p>}
      <section className="presentation-composer" aria-label="발표자료 만들기">
        {run && <h3>{base ? '새 버전 만들기' : '다른 목차로 PPT 만들기'}</h3>}
        <GenerationForm
          project={project}
          name={name}
          state={state}
          editable={editable}
          active={active}
          busy={!!working}
          base={base}
          onCancelBase={() => setBase(null)}
          onCreated={onCreated}
        />
      </section>
    </section>
  );
}
function status(run: Run) {
  if (run.status === 'succeeded')
    return '완성되었습니다. PPTX를 내려받아 PowerPoint에서 편집할 수 있습니다.';
  if (
    run.status === 'failed' &&
    ['template_slot_capacity', 'template_material_missing', 'template_text_capacity'].includes(
      run.error_code ?? '',
    )
  )
    return '선택한 템플릿의 배치에 내용을 담지 못했습니다. 넣을 자료를 줄이거나 다른 템플릿을 선택하세요. 완료한 내용은 보존했습니다.';
  if (run.status === 'failed')
    return '생성을 완료하지 못했습니다. AI 연결·입력과 템플릿을 확인한 뒤 다시 시도하세요. 완료한 내용은 보존했습니다.';
  if (run.status === 'cancelled')
    return '생성을 중단했습니다. 완료한 내용부터 이어서 만들 수 있습니다.';
  if (run.status === 'queued') return '생성 순서를 기다리고 있습니다.';
  return run.stage === 'rendering'
    ? 'PPT 파일과 미리보기를 만들고 내용을 확인하고 있습니다.'
    : `슬라이드 내용을 작성하고 있습니다. ${run.completed} / ${run.total}장`;
}
