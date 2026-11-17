// Purpose: Start and monitor explicit outline generation or scoped content mapping.
// Pattern: Server-selected saved models, stable retry receipts and shared durable run projections.
// Usage: OutlineEditor disables commands while local changes are unsaved.
// Related: api.ts, features/providers public facade, workspace.tsx.
import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { WandSparkles, ChevronDown } from 'lucide-react';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { WorkflowStatus } from './workflow-status';
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
  const [expanded, setExpanded] = useState(!state.version);
  const client = useQueryClient();
  const receipt = useRef<{ stamp: string; key: string } | null>(null);
  const running = !!state.run && ['queued', 'running'].includes(state.run.status);
  const refresh = () => void client.invalidateQueries({ queryKey: outlineKeys.all });
  const generate = useMutation({
    mutationFn: async ({ kind, all = false }: { kind: 'generate' | 'map'; all?: boolean }) => {
      const input: Generate = {
        expected_version: state.version,
        source_snapshot: state.source_snapshot,
        guide_version: state.guide_version,
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
          <Button
            disabled={busy || !state.ready}
            onClick={() => generate.mutate({ kind: 'generate' })}
          >
            <WandSparkles aria-hidden="true" />
            {state.version ? '새 목차 만들기' : '목차 만들기'}
          </Button>
          {state.version > 0 && (
            <Button
              variant="secondary"
              disabled={busy || state.stale}
              onClick={() => generate.mutate({ kind: 'map', all: true })}
            >
              전체 내용 자동 연결
            </Button>
          )}
          {state.version > 0 && (
            <Button
              variant="secondary"
              disabled={busy || state.stale}
              onClick={() => generate.mutate({ kind: 'map' })}
            >
              {selected ? '선택 목차 자동 연결' : '내용 자동 연결'}
            </Button>
          )}
        </CollapsibleContent>
      </Collapsible>
      {(generate.isError || control.isError) && (
        <p role="alert">{errorMessage(generate.error ?? control.error)}</p>
      )}
      {state.run && <WorkflowStatus run={state.run} />}
      {state.run && state.run.status !== 'succeeded' && (
        <div className="outline-run" role="status">
          {running ? (
            <>
              <p>
                {state.run.status === 'queued'
                  ? '시작을 기다리고 있습니다.'
                  : state.run.kind === 'generate'
                    ? '목차를 구성하고 있습니다.'
                    : '원문 내용을 연결하고 있습니다.'}
              </p>
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
                {state.run.error_code === 'workflow_incompatible'
                  ? '이 작업을 이어갈 수 없는 상태입니다. 기존 목차는 유지됩니다. 관리자에게 확인을 요청하세요.'
                  : state.run.error_code === 'inputs_changed'
                    ? '원본·작성 방향 또는 목차가 바뀌어 결과를 적용하지 않았습니다. 최신 내용으로 다시 시작하세요.'
                    : '자동 구성을 완료하지 못했습니다. 기존 목차와 입력은 유지됩니다.'}
              </p>
              {!['inputs_changed', 'workflow_incompatible'].includes(
                state.run.error_code ?? '',
              ) && (
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
