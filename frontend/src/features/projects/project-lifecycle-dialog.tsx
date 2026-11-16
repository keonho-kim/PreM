// Purpose: Confirm versioned archive, restore or logical deletion without losing conflict context.
// Pattern: Controlled shadcn Alert Dialog; conflict recovery explicitly reloads the target before resubmission.
// Usage: ProjectDirectory pins the selected project and action for this dialog session.
// Related: api.ts, project-dialog.tsx.
import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { ApiError, errorMessage } from '@/shared/api/http';
import { changeProjectStatus, deleteProject, getProject, type Project } from './api';
export function ProjectLifecycleDialog({
  project,
  action,
  onClose,
  onSaved,
  returnFocus,
}: {
  returnFocus?: HTMLElement;
  project: Project;
  action: 'status' | 'delete';
  onClose: () => void;
  onSaved: () => void;
}) {
  const committed = useRef(false);
  const [base, setBase] = useState(project),
    [notice, setNotice] = useState('');
  const mutation = useMutation({
    mutationFn: () => (action === 'delete' ? deleteProject(base) : changeProjectStatus(base)),
    retry: false,
    onSuccess: () => {
      committed.current = true;
      onSaved();
    },
  });
  const refresh = useMutation({
    mutationFn: () => getProject(project.id),
    onSuccess: (latest) => {
      setBase(latest);
      mutation.reset();
      setNotice('최신 정보를 확인했습니다. 아래 내용을 검토한 후 다시 실행하세요.');
    },
  });
  const pending = mutation.isPending || refresh.isPending;
  const verb = action === 'delete' ? '삭제' : base.status === 'active' ? '보관' : '복원';
  const error = mutation.error ?? refresh.error;
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <AlertDialogContent
        className="project-dialog"
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          (committed.current
            ? document.querySelector<HTMLElement>('main h1')
            : returnFocus
          )?.focus();
        }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (pending) return;
            mutation.mutate();
          }}
        >
          <AlertDialogTitle>프로젝트 {verb}</AlertDialogTitle>
          <p>
            <strong>{base.name}</strong>
          </p>
          <AlertDialogDescription className="muted">
            {action === 'delete'
              ? '모든 접속자의 목록에서 제거됩니다. 데이터는 보존되며, 현재 화면에서는 삭제를 취소할 수 없습니다.'
              : base.status === 'active'
                ? '진행 중 목록에서 제외합니다. 보관됨 필터에서 다시 복원할 수 있습니다.'
                : '공유 프로젝트를 진행 중 목록으로 되돌립니다.'}
          </AlertDialogDescription>
          <p role="status" className={error ? 'form-message error' : 'form-message'}>
            {pending ? '처리 중입니다.' : error ? errorMessage(error) : notice}
          </p>
          {error instanceof ApiError && error.code === 'revision_conflict' && (
            <Button variant="secondary" disabled={pending} onClick={() => refresh.mutate()}>
              최신 정보 확인
            </Button>
          )}
          <div className="dialog-actions">
            <AlertDialogCancel disabled={pending}>취소</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              disabled={pending}
              onClick={(event) => {
                event.preventDefault();
                mutation.mutate();
              }}
            >
              {verb}
            </AlertDialogAction>
          </div>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
