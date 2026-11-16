// Purpose: Start and monitor explicit outline generation or scoped content mapping.
// Pattern: Server-selected saved models, stable retry receipts and shared durable run projections.
// Usage: OutlineEditor disables commands while local changes are unsaved.
// Related: api.ts, features/providers public facade, workspace.tsx.
import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { WandSparkles, ChevronDown } from 'lucide-react';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { listAuthoringModels, authoringModelsKey } from '@/features/providers';
import { errorMessage } from '@/shared/api/http';
import { createRun, commandRun, outlineKeys, type OutlineState, type Generate } from './api';
export function Generation({
  project,
  state,
  disabled,
  selected,
}: {
  project: string;
  state: OutlineState;
  disabled: boolean;
  selected: string;
}) {
  const [model, setModel] = useState('');
  const [expanded, setExpanded] = useState(!state.version);
  const client = useQueryClient();
  const receipt = useRef<{ stamp: string; key: string } | null>(null);
  const providers = useQuery({
    queryKey: authoringModelsKey,
    queryFn: ({ signal }) => listAuthoringModels(signal),
  });
  const options = providers.data ?? [];
  const provider = options.find((p) => p.id === model);
  const running = !!state.run && ['queued', 'running'].includes(state.run.status);
  const refresh = () => void client.invalidateQueries({ queryKey: outlineKeys.all });
  const generate = useMutation({
    mutationFn: async ({ kind, all = false }: { kind: 'generate' | 'map'; all?: boolean }) => {
      if (!provider) throw Error('목차 작성에 사용할 AI를 선택하세요.');
      const input: Generate = {
        expected_version: state.version,
        source_snapshot: state.source_snapshot,
        guide_version: state.guide_version,
        connection_id: provider.id,
        model_version: provider.version,
        kind,
        node_ids: kind === 'map' && selected && !all ? [selected] : [],
      };
      const stamp = JSON.stringify(input);
      if (receipt.current?.stamp !== stamp) receipt.current = { stamp, key: crypto.randomUUID() };
      return createRun(project, receipt.current.key, input);
    },
    retry: false,
    onSuccess: () => {
      receipt.current = null;
      setExpanded(false);
      refresh();
    },
    onError: () => {
      refresh();
      void providers.refetch();
    },
  });
  const commandReceipt = useRef<{ stamp: string; key: string } | null>(null);
  const control = useMutation({
    mutationFn: async (action: 'cancel' | 'retry') => {
      if (!state.run) throw Error('작업을 확인하세요.');
      const stamp = `${state.run.id}:${state.run.version}:${action}`;
      if (commandReceipt.current?.stamp !== stamp)
        commandReceipt.current = { stamp, key: crypto.randomUUID() };
      return commandRun(project, state.run, action, commandReceipt.current.key);
    },
    retry: false,
    onSuccess: refresh,
    onError: refresh,
  });
  const busy = disabled || running || generate.isPending;
  return (
    <section className="outline-generation" aria-label="자동 구성">
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost">
            <WandSparkles aria-hidden="true" />
            AI로 구성
            <ChevronDown aria-hidden="true" />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="outline-generation-controls">
          <div>
            <Label htmlFor="outline-model">작성에 사용할 AI</Label>
            <Select value={model} onValueChange={setModel} disabled={running}>
              <SelectTrigger id="outline-model">
                <SelectValue placeholder="사용할 AI 선택" />
              </SelectTrigger>
              <SelectContent>
                {options.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            disabled={busy || !provider || !state.ready}
            onClick={() => generate.mutate({ kind: 'generate' })}
          >
            <WandSparkles aria-hidden="true" />
            {state.version ? '새 목차 만들기' : '목차 만들기'}
          </Button>
          {state.version > 0 && (
            <Button
              variant="secondary"
              disabled={busy || !provider || state.stale}
              onClick={() => generate.mutate({ kind: 'map', all: true })}
            >
              전체 내용 자동 연결
            </Button>
          )}
          {state.version > 0 && (
            <Button
              variant="secondary"
              disabled={busy || !provider || state.stale}
              onClick={() => generate.mutate({ kind: 'map' })}
            >
              {selected ? '선택 목차 자동 연결' : '내용 자동 연결'}
            </Button>
          )}
          {!options.length && !providers.isPending && (
            <p>
              <Link to="/admin?section=providers">모델 연결</Link>에서 AI를 등록하거나 아래에서 직접
              작성할 수 있습니다.
            </p>
          )}
          {providers.isError && (
            <p role="alert">
              AI 목록을 불러오지 못했습니다.{' '}
              <Button
                variant="secondary"
                onClick={() => {
                  void providers.refetch();
                }}
              >
                다시 불러오기
              </Button>
            </p>
          )}
        </CollapsibleContent>
      </Collapsible>
      {(generate.isError || control.isError) && (
        <p role="alert">{errorMessage(generate.error ?? control.error)}</p>
      )}
      {state.run && state.run.status !== 'succeeded' && (
        <div className="outline-run" role="status">
          {running ? (
            <>
              <p>
                {state.run.kind === 'generate'
                  ? '목차를 구성하고 있습니다.'
                  : '원문 내용을 연결하고 있습니다.'}
              </p>
              <Progress
                aria-label="구성 진행률"
                value={state.run.total ? (state.run.completed / state.run.total) * 100 : undefined}
              />
              <Button
                variant="ghost"
                disabled={control.isPending}
                onClick={() => control.mutate('cancel')}
              >
                작업 취소
              </Button>
            </>
          ) : state.run.status === 'failed' ? (
            <>
              <p>
                {state.run.error_code === 'inputs_changed'
                  ? '원본·작성 방향 또는 목차가 바뀌어 결과를 적용하지 않았습니다. 최신 내용으로 다시 시작하세요.'
                  : '자동 구성을 완료하지 못했습니다. 기존 목차와 입력은 유지됩니다.'}
              </p>
              {state.run.error_code !== 'inputs_changed' && (
                <Button
                  variant="secondary"
                  disabled={disabled || control.isPending}
                  onClick={() => control.mutate('retry')}
                >
                  작업 다시 시도
                </Button>
              )}
            </>
          ) : state.run.status === 'cancelled' ? (
            <>
              <p>작업을 취소했습니다. 기존 목차는 유지됩니다.</p>
              <Button
                variant="secondary"
                disabled={disabled || control.isPending}
                onClick={() => control.mutate('retry')}
              >
                작업 이어하기
              </Button>
            </>
          ) : (
            <p>자동 구성을 마쳤습니다. 원문과 연결 내용을 확인한 뒤 확정하세요.</p>
          )}
          <p className="field-hint">
            원문의 문단·표 등 {state.run.total_blocks}개 중 {state.run.included_blocks}개를
            사용합니다. 긴 내용은 일부 발췌하며, 원문 전체는 연결 화면에서 확인할 수 있습니다.
          </p>
        </div>
      )}
      {state.run?.status === 'succeeded' && (
        <Collapsible className="outline-coverage">
          <CollapsibleTrigger asChild>
            <Button variant="ghost">
              자동 구성에 사용한 범위
              <ChevronDown aria-hidden="true" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <p className="field-hint">
              원문 {state.run.total_blocks}개 중 {state.run.included_blocks}개를 사용했습니다. 긴
              내용은 일부 발췌했습니다. 연결된 원문을 검토한 뒤 확정하세요.
            </p>
          </CollapsibleContent>
        </Collapsible>
      )}
    </section>
  );
}
