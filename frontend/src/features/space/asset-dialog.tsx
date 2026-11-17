// Purpose: Edit shared metadata or confirm lifecycle changes with revision conflict review.
// Pattern: shadcn modal primitives; immutable file bytes are never edited by these commands.
// Usage: Space pins the chosen asset and returns focus to its menu after cancellation.
// Related: api.ts, asset-card.tsx, space-directory.tsx.
import { useId, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { ApiError, errorMessage } from '@/shared/api/http';
import {
  changeMetadata,
  changeStatus,
  getAsset,
  metadataSchema,
  parseTags,
  removeAsset,
  type Asset,
  type LibraryKind,
} from './api';
export function AssetDialog({
  kind,
  item,
  action,
  onClose,
  onSaved,
  returnFocus,
}: {
  kind: LibraryKind;
  item: Asset;
  action: 'edit' | 'status' | 'delete';
  onClose: () => void;
  onSaved: () => void;
  returnFocus?: HTMLElement;
}) {
  const id = useId(),
    committed = useRef(false);
  const [base, setBase] = useState(item),
    [title, setTitle] = useState(item.title),
    [tags, setTags] = useState(item.tags.join(', ')),
    [validation, setValidation] = useState(''),
    [notice, setNotice] = useState('');
  const desired = item.status === 'active' ? 'archived' : 'active';
  const verb =
    action === 'edit'
      ? '정보 수정'
      : action === 'delete'
        ? '삭제'
        : desired === 'archived'
          ? '보관'
          : '복원';
  const mutation = useMutation({
    mutationFn: async () => {
      if (action === 'delete') return removeAsset(kind, base);
      if (action === 'status') return changeStatus(kind, base, desired);
      const value = metadataSchema.parse({ title, tags: parseTags(tags) });
      return changeMetadata(kind, base, value.title, value.tags);
    },
    retry: false,
    onSuccess: () => {
      committed.current = true;
      onSaved();
    },
  });
  const latest = useMutation({
    mutationFn: () => getAsset(kind, item.id),
    onSuccess: (value) => {
      setBase(value);
      mutation.reset();
      setNotice(
        `현재 자료: ${value.title}, 변경 버전 ${value.version}. 내용을 확인한 후 다시 실행하세요.`,
      );
    },
  });
  const pending = mutation.isPending || latest.isPending,
    editing = action === 'edit';
  const Root = editing ? Dialog : AlertDialog,
    Content = editing ? DialogContent : AlertDialogContent,
    Title = editing ? DialogTitle : AlertDialogTitle,
    Description = editing ? DialogDescription : AlertDialogDescription;
  const error = mutation.error ?? latest.error;
  function submit() {
    if (pending) return;
    if (editing) {
      const parsed = metadataSchema.safeParse({ title, tags: parseTags(tags) });
      if (!parsed.success) {
        setValidation(parsed.error.issues[0]?.message ?? '입력을 확인하세요.');
        return;
      }
    }
    setValidation('');
    mutation.mutate();
  }
  return (
    <Root
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <Content
        className="space-dialog"
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          (committed.current || !returnFocus?.isConnected
            ? document.querySelector<HTMLElement>('main h1')
            : returnFocus
          )?.focus();
        }}
      >
        <Title>자료 {verb}</Title>
        <Description>
          {editing
            ? '이름과 태그 변경은 팀 전체에 반영됩니다.'
            : action === 'delete'
              ? '공용 목록에서 제거합니다. 원본과 파일 버전은 보존되며 현재 화면에서 삭제를 취소할 수 없습니다.'
              : desired === 'archived'
                ? '진행 중 목록에서 제외합니다. 보관됨 필터에서 복원할 수 있습니다.'
                : '공용 목록에 다시 표시합니다.'}
        </Description>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          {editing ? (
            <>
              <Label htmlFor={`${id}-title`}>자료 이름</Label>
              <Input
                id={`${id}-title`}
                value={title}
                required
                maxLength={120}
                readOnly={pending}
                onChange={(event) => setTitle(event.target.value)}
              />
              <Label htmlFor={`${id}-tags`}>태그</Label>
              <Input
                id={`${id}-tags`}
                value={tags}
                readOnly={pending}
                maxLength={320}
                onChange={(event) => setTags(event.target.value)}
              />
              <p className="field-hint">쉼표로 구분 · 최대 12개 · 태그당 24자</p>
            </>
          ) : (
            <strong>{base.title}</strong>
          )}
          <p role="status" className={error || validation ? 'space-error' : 'muted'}>
            {pending
              ? '요청을 처리하고 있습니다.'
              : validation || (error ? errorMessage(error) : notice)}
          </p>
          {error instanceof ApiError && error.code === 'revision_conflict' && (
            <Button variant="secondary" disabled={pending} onClick={() => latest.mutate()}>
              최신 정보 확인
            </Button>
          )}
          <div className="dialog-actions">
            {editing ? (
              <>
                <Button variant="secondary" disabled={pending} onClick={onClose}>
                  취소
                </Button>
                <Button type="submit" disabled={pending}>
                  저장
                </Button>
              </>
            ) : (
              <>
                <AlertDialogCancel disabled={pending}>취소</AlertDialogCancel>
                <AlertDialogAction
                  disabled={pending}
                  onClick={(event) => {
                    event.preventDefault();
                    submit();
                  }}
                >
                  {verb}
                </AlertDialogAction>
              </>
            )}
          </div>
        </form>
      </Content>
    </Root>
  );
}
