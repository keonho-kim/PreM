// Purpose: Run real current-slide conversation through a bounded proposal/approval workflow.
// Pattern: Official shadcn AI compositions; Query owns messages and Redux owns scoped drafts.
// Usage: Right inspector AI tab; no model execution occurs on typing or component selection.
// Related: edit-api.ts, edit-proposal.tsx, backend/modules/presentations/edits.rs.
import { useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
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
import { errorMessage } from '@/shared/api/http';
import { presentationKeys, type Run, type Slide } from './api';
import { sendEdit, editCommand, editKeys, type Edit, type EditRequest } from './edit-api';
import { useChatDraft } from './chat-state';
import type { EditThread } from './use-edit-thread';
import { EditProposal } from './edit-proposal';
import './slide-chat.css';
export function SlideChat({
  project,
  run,
  slide,
  history,
  session,
  reviewing = false,
  canEdit,
  targetSlides,
  objectIds = [],
  onResult,
}: {
  project: string;
  run: Run;
  slide: Slide;
  history: EditThread;
  session: string | null;
  reviewing?: boolean;
  canEdit: boolean;
  targetSlides?: Slide[];
  objectIds?: string[];
  onResult: (id: string) => void;
}) {
  const targets = targetSlides?.length ? targetSlides : [slide];
  const selectedObjects = targets.length === 1 ? objectIds : [];
  const scopeKey = `${project}:${run.id}:${slide.id}`;
  const { draft, update, current } = useChatDraft(scopeKey);
  const form = useRef<HTMLFormElement>(null),
    field = useRef<HTMLTextAreaElement>(null);
  const receipt = useRef<{ stamp: string; key: string } | null>(null),
    control = useRef<{ stamp: string; key: string } | null>(null),
    client = useQueryClient();
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
      if (current().prompt === input.prompt) update(scopeKey, { prompt: '' });
      refresh();
    },
    onError: () => {
      refresh();
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
      return editCommand(project, edit, action, control.current.key, session);
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
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editable || !session || busy || reviewing || send.isPending) return;
    if (!draft.prompt.trim()) {
      field.current?.focus();
      return;
    }
    send.mutate({
      expected_version: run.presentation_version,
      prompt: draft.prompt,
      fields: selectedObjects.length
        ? ['objects']
        : ['title', 'bullets', 'notes', 'objects', 'layout'],
      ...(targets.length > 1 ? { slide_ids: targets.map((s) => s.id) } : {}),
      ...(selectedObjects.length ? { object_ids: selectedObjects } : {}),
    });
  }
  return (
    <section className="slide-chat" aria-label="슬라이드 AI 대화">
      <p className="slide-chat-target field-hint" role="status">
        {selectedObjects.length
          ? `슬라이드 ${slide.position} · 선택한 객체 ${selectedObjects.length}개만`
          : targets.length > 1
            ? `${targets.map((s) => s.position).join(', ')}번 장표 전체 · ${targets.length}장`
            : `슬라이드 ${slide.position} 전체`}
      </p>
      <MessageScrollerProvider>
        <MessageScroller className="slide-chat-thread">
          <MessageScrollerViewport>
            <MessageScrollerContent role="log" aria-label="대화 이력" aria-live="polite">
              {rows.length === 0 && (
                <div className="slide-chat-empty">
                  <h3>어떻게 다듬을까요?</h3>
                  <p>
                    선택한 장표의 내용·이미지·차트·배치를 요청에 맞게 수정합니다. 수정안을 확인한 뒤
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
                        <MessageHeader>PreM</MessageHeader>
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
                          pending={command.isPending || (!session && edit.status === 'ready')}
                          onCommand={(action) => command.mutate({ edit, action })}
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
      {history.isError && (
        <p role="alert">
          {errorMessage(history.error)}{' '}
          <Button
            variant="ghost"
            onClick={() => {
              void history.refetch();
            }}
          >
            다시 확인
          </Button>
        </p>
      )}
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
      {reviewing && (
        <p className="field-hint">수정안을 적용하거나 취소한 뒤 다음 요청을 입력하세요.</p>
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
            disabled={!editable || !session || reviewing || send.isPending}
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
              disabled={
                !editable || !session || busy || reviewing || send.isPending || !draft.prompt.trim()
              }
            >
              <ArrowUp aria-hidden="true" />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </form>
    </section>
  );
}
