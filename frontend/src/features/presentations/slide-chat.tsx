// Purpose: Run real current-slide conversation through a bounded proposal/approval workflow.
// Pattern: Official shadcn AI compositions; Query owns messages and Zustand owns scoped drafts.
// Usage: Right inspector AI tab; no model execution occurs on typing or component selection.
// Related: edit-api.ts, edit-proposal.tsx, backend/modules/presentations/edits.rs.
import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { MessageGroup, Message, MessageContent, MessageHeader } from '@/components/ui/message';
import { Bubble, BubbleContent } from '@/components/ui/bubble';
import {
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
} from '@/components/ui/message-scroller';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from '@/components/ui/input-group';
import { listAuthoringModels, authoringModelsKey } from '@/features/providers';
import { errorMessage } from '@/shared/api/http';
import { presentationKeys, type Run, type Slide } from './api';
import { getEdits, sendEdit, editCommand, editKeys, type Edit, type EditRequest } from './edit-api';
import { useChatDrafts, emptyChatDraft } from './chat-drafts';
import { EditProposal } from './edit-proposal';
import './slide-chat.css';
export function SlideChat({
  project,
  run,
  slide,
  active,
  canEdit,
  onResult,
}: {
  project: string;
  run: Run;
  slide: Slide;
  active: boolean;
  canEdit: boolean;
  onResult: (id: string) => void;
}) {
  const scopeKey = `${project}:${run.id}:${slide.id}`;
  const draft = useChatDrafts((state) => state.drafts[scopeKey] ?? emptyChatDraft),
    update = useChatDrafts((state) => state.update);
  const [localError, setLocalError] = useState('');
  const form = useRef<HTMLFormElement>(null),
    field = useRef<HTMLTextAreaElement>(null);
  const receipt = useRef<{ stamp: string; key: string } | null>(null),
    control = useRef<{ stamp: string; key: string } | null>(null),
    client = useQueryClient();
  const models = useQuery({
    queryKey: authoringModelsKey,
    queryFn: ({ signal }) => listAuthoringModels(signal),
    enabled: active,
  });
  const history = useQuery({
    queryKey: editKeys.thread(project, run.id, slide.id),
    queryFn: ({ signal }) => getEdits(project, run.id, slide.id, signal),
    enabled: active && run.status === 'succeeded',
    refetchInterval: (q) =>
      !active
        ? false
        : q.state.data?.some((e) => ['queued', 'running', 'applying'].includes(e.status))
          ? 1500
          : 15000,
  });
  const rows = history.data ?? [],
    busy = rows.some((e) => ['queued', 'running'].includes(e.status));
  const refresh = () => {
    void client.invalidateQueries({ queryKey: editKeys.all });
    void client.invalidateQueries({ queryKey: presentationKeys.all });
  };
  const send = useMutation({
    mutationFn: (input: EditRequest) => {
      const stamp = JSON.stringify([project, run.id, slide.id, input]);
      if (receipt.current?.stamp !== stamp) receipt.current = { stamp, key: crypto.randomUUID() };
      return sendEdit(project, run.id, slide.id, receipt.current.key, input);
    },
    retry: false,
    onSuccess: (_e, input) => {
      receipt.current = null;
      if (useChatDrafts.getState().drafts[scopeKey]?.prompt === input.prompt)
        update(scopeKey, { prompt: '' });
      refresh();
    },
    onError: () => {
      refresh();
      void models.refetch();
    },
  });
  const command = useMutation({
    mutationFn: ({
      edit,
      action,
    }: {
      edit: Edit;
      action: 'apply' | 'reject' | 'retry' | 'cancel';
    }) => {
      const stamp = `${edit.id}:${edit.version}:${action}`;
      if (control.current?.stamp !== stamp) control.current = { stamp, key: crypto.randomUUID() };
      return editCommand(project, edit, action, control.current.key);
    },
    retry: false,
    onSuccess: (e) => {
      control.current = null;
      refresh();
      if (e.applied_run_id) onResult(e.applied_run_id);
    },
    onError: refresh,
  });
  const editable = canEdit && run.status === 'succeeded' && run.is_current;
  const priorModel = rows.at(-1)?.connection_id;
  const modelId =
    draft.model || (models.data?.some((m) => m.id === priorModel) ? (priorModel ?? '') : '');
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editable || busy || send.isPending) return;
    const model = models.data?.find((m) => m.id === modelId);
    if (!model) {
      setLocalError('수정에 사용할 AI를 선택하세요.');
      return;
    }
    if (!draft.prompt.trim()) {
      field.current?.focus();
      return;
    }
    setLocalError('');
    send.mutate({
      expected_version: run.presentation_version,
      connection_id: model.id,
      model_version: model.version,
      prompt: draft.prompt,
      fields: draft.scope === 'slide' ? ['title', 'bullets', 'notes'] : [draft.scope],
    });
  }
  return (
    <section className="slide-chat" aria-label="슬라이드 AI 대화">
      <div className="slide-chat-options">
        <div>
          <Label htmlFor="slide-edit-model">수정에 사용할 AI</Label>
          <Select value={modelId} onValueChange={(model) => update(scopeKey, { model })}>
            <SelectTrigger id="slide-edit-model">
              <SelectValue placeholder="AI 선택" />
            </SelectTrigger>
            <SelectContent>
              {models.data?.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="slide-edit-scope">수정 범위</Label>
          <Select value={draft.scope} onValueChange={(scope) => update(scopeKey, { scope })}>
            <SelectTrigger id="slide-edit-scope">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(
                [
                  ['slide', '현재 슬라이드'],
                  ['title', '제목만'],
                  ['bullets', '본문만'],
                  ['notes', '발표 메모만'],
                ] as const
              ).map(([value, label]) => (
                <SelectItem key={value} value={value ?? ''}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <MessageScrollerProvider>
        <MessageScroller className="slide-chat-thread">
          <MessageScrollerViewport>
            <MessageScrollerContent role="log" aria-label="대화 이력" aria-live="polite">
              {rows.length === 0 && (
                <div className="slide-chat-empty">
                  <h3>어떻게 다듬을까요?</h3>
                  <p>
                    현재 슬라이드의 제목·본문·메모를 요청에 맞게 수정합니다. 수정안을 확인한 뒤
                    적용하세요.
                  </p>
                </div>
              )}
              {rows.map((edit) => (
                <MessageScrollerItem key={edit.id}>
                  <MessageGroup>
                    <Message align="end">
                      <MessageContent>
                        <MessageHeader>요청</MessageHeader>
                        <Bubble variant="secondary" align="end">
                          <BubbleContent>{edit.prompt}</BubbleContent>
                        </Bubble>
                      </MessageContent>
                    </Message>
                    <Message>
                      <MessageContent>
                        <MessageHeader>PuPuTyX</MessageHeader>
                        {edit.message && (
                          <Bubble variant="ghost">
                            <BubbleContent>{edit.message}</BubbleContent>
                          </Bubble>
                        )}
                        <EditProposal
                          edit={edit}
                          current={
                            editable &&
                            edit.base_revision_id === run.id &&
                            edit.base_version === run.presentation_version
                          }
                          pending={command.isPending}
                          onCommand={(action) => command.mutate({ edit, action })}
                          onResult={onResult}
                        />
                      </MessageContent>
                    </Message>
                  </MessageGroup>
                </MessageScrollerItem>
              ))}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>
      {(history.isError || models.isError) && (
        <p role="alert">
          {errorMessage(history.error ?? models.error)}{' '}
          <Button
            variant="ghost"
            onClick={() => {
              void history.refetch();
              void models.refetch();
            }}
          >
            다시 확인
          </Button>
        </p>
      )}
      {localError && <p role="alert">{localError}</p>}
      {send.isError && <p role="alert">{errorMessage(send.error)}</p>}
      {command.isError && <p role="alert">{errorMessage(command.error)}</p>}
      {!editable && (
        <p className="field-hint">
          {!canEdit
            ? '보관된 프로젝트입니다. 복원 후 수정할 수 있습니다.'
            : run.status === 'succeeded'
              ? '이전 버전입니다. 최신 발표자료를 선택하면 수정할 수 있습니다.'
              : 'PPT가 완성되면 대화로 수정할 수 있습니다.'}
        </p>
      )}
      <form ref={form} onSubmit={submit} aria-label="슬라이드 수정 요청">
        <Label className="sr-only" htmlFor="slide-edit-prompt">
          슬라이드 수정 요청
        </Label>
        <InputGroup>
          <InputGroupTextarea
            ref={field}
            id="slide-edit-prompt"
            value={draft.prompt}
            maxLength={2000}
            placeholder="예: 제목을 더 짧게 바꿔줘"
            disabled={!editable || send.isPending}
            onChange={(e) => update(scopeKey, { prompt: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
                form.current?.requestSubmit();
              }
            }}
          />
          <InputGroupAddon align="block-end">
            <span className="field-hint">슬라이드 {slide.position} · Enter 전송</span>
            <InputGroupButton
              type="submit"
              variant="default"
              size="icon-sm"
              aria-label="수정 요청 보내기"
              disabled={!editable || busy || send.isPending || !draft.prompt.trim()}
            >
              <ArrowUp aria-hidden="true" />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </form>
    </section>
  );
}
