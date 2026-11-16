// Purpose: Compose compact creation settings, durable history and the slide workbench.
// Pattern: Query owns jobs; disclosures preserve request drafts and panels own their view state.
// Usage: Studio generation step; existing persistence and model commands remain explicit.
// Related: generation-form.tsx, deck-preview.tsx, api.ts.
import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, Settings2, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { errorMessage } from '@/shared/api/http';
import {
  listRuns,
  controlRun,
  downloadUrl,
  presentationKeys,
  type Preparation,
  type Run,
} from './api';
import { DeckPreview } from './deck-preview';
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
    [selected, setSelected] = useState(''),
    [settingsOpen, setSettingsOpen] = useState<boolean | null>(null);
  const client = useQueryClient(),
    receipt = useRef<{ stamp: string; key: string } | null>(null);
  const history = useQuery({
    queryKey: presentationKeys.runs(project),
    queryFn: ({ signal }) => listRuns(project, signal),
    enabled: active,
    refetchInterval: active ? 2000 : false,
  });
  const working = history.data?.find((r) => ['queued', 'running'].includes(r.status));
  const run = history.data?.find((r) => r.id === selected) ?? history.data?.[0];
  const open = settingsOpen ?? !run;
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
      <header className="presentation-heading">
        <div>
          <h2>{run ? '발표자료' : '발표자료를 만들어보세요'}</h2>
          <p className="muted">슬라이드를 확인하고 내용·메모와 참고 자료를 함께 검토하세요.</p>
        </div>
      </header>
      <Collapsible className="presentation-settings" open={open} onOpenChange={setSettingsOpen}>
        <div className="presentation-command-row">
          {!!history.data?.length && (
            <div className="presentation-history">
              <Label htmlFor="presentation-history">만든 발표자료</Label>
              <Select value={run?.id ?? ''} onValueChange={setSelected}>
                <SelectTrigger id="presentation-history">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {history.data.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.title} · {new Date(r.created_at).toLocaleString('ko-KR')} ·{' '}
                      {
                        (
                          {
                            succeeded: '완료',
                            failed: '확인 필요',
                            cancelled: '중단',
                            queued: '대기',
                            running: '만드는 중',
                          } as const
                        )[r.status]
                      }
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <CollapsibleTrigger asChild>
            <Button variant="secondary">
              <Settings2 aria-hidden="true" />
              PPT 생성 설정
              <ChevronDown aria-hidden="true" />
            </Button>
          </CollapsibleTrigger>
          {run?.status === 'succeeded' && (
            <Button
              variant="ghost"
              disabled={!editable || !!working}
              onClick={() => {
                setBase(run);
                setSettingsOpen(true);
              }}
            >
              이 발표자료 새 버전 만들기
            </Button>
          )}
        </div>
        <CollapsibleContent forceMount hidden={!open}>
          <GenerationForm
            project={project}
            name={name}
            state={state}
            editable={editable}
            active={active}
            busy={!!working}
            base={base}
            onCancelBase={() => setBase(null)}
            onCreated={(r) => {
              setBase(null);
              setSelected(r.id);
              setSettingsOpen(false);
              client.setQueryData<Run[]>(presentationKeys.runs(project), (rows) => [
                r,
                ...(rows ?? []).filter((v) => v.id !== r.id),
              ]);
              refresh();
            }}
          />
        </CollapsibleContent>
      </Collapsible>
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
          <div className="presentation-run-status">
            <div>
              <strong>{run.title}</strong>
              <p role="status">{status(run)}</p>
            </div>
            {run.status === 'succeeded' ? (
              <Button asChild>
                <a href={downloadUrl(project, run.id)}>
                  <Download aria-hidden="true" />
                  PPTX 다운로드
                </a>
              </Button>
            ) : ['queued', 'running'].includes(run.status) ? (
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
          <DeckPreview
            key={run.presentation_id}
            project={project}
            run={run}
            active={active}
            canEdit={editable}
            onResult={(id) => {
              setSelected(id);
              refresh();
            }}
          />
        </>
      )}
      {command.isError && <p role="alert">{errorMessage(command.error)}</p>}
    </section>
  );
}
function status(run: Run) {
  if (run.status === 'succeeded')
    return '완성되었습니다. PPTX를 내려받아 PowerPoint에서 편집할 수 있습니다.';
  if (run.status === 'failed')
    return '생성을 완료하지 못했습니다. AI 연결·입력과 템플릿을 확인한 뒤 다시 시도하세요. 완료한 내용은 보존했습니다.';
  if (run.status === 'cancelled')
    return '생성을 중단했습니다. 완료한 내용부터 이어서 만들 수 있습니다.';
  if (run.status === 'queued') return '생성 순서를 기다리고 있습니다.';
  return run.stage === 'rendering'
    ? 'PPT 파일과 미리보기를 만들고 내용을 확인하고 있습니다.'
    : `슬라이드 내용을 작성하고 있습니다. ${run.completed} / ${run.total}장`;
}
