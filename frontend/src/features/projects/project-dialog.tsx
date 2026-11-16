// Purpose: Create or rename a shared project without losing failed input.
// Pattern: Controlled shadcn dialog, mutation-owned request key and explicit conflict review.
// Usage: Mounted for one edit session by ProjectDirectory.
// Related: api.ts, project-directory.tsx, projects.css.
import { useId, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DueDatePicker } from './due-date-picker';
import { Button } from '@/components/ui/button';
import { ApiError, errorMessage } from '@/shared/api/http';
import { createProject, getProject, renameProject, type Project } from './api';

type Props = {
  returnFocus?: HTMLElement;
  project: Project | null;
  copy?: Project;
  onClose: () => void;
  onSaved: (project: Project) => void;
};
export function ProjectDialog({ project, copy, onClose, onSaved, returnFocus }: Props) {
  const committed = useRef(false);
  const inputId = useId(),
    errorId = useId();
  const [name, setName] = useState(
    project?.name ?? (copy ? `${Array.from(copy.name).slice(0, 77).join('')} 사본` : ''),
  );
  const [dueDate, setDueDate] = useState(copy?.due_date ?? '');
  const dateId = useId();
  const [base, setBase] = useState(project);
  const [notice, setNotice] = useState('');
  const [validation, setValidation] = useState('');
  const requestKey = useRef<{ name: string; dueDate: string; key: string } | null>(null);
  const mutation = useMutation({
    mutationFn: async (value: string) => {
      if (base) return renameProject(base, value);
      if (
        !requestKey.current ||
        requestKey.current.name !== value ||
        requestKey.current.dueDate !== dueDate
      )
        requestKey.current = { name: value, dueDate, key: crypto.randomUUID() };
      return createProject(value, dueDate, requestKey.current.key);
    },
    retry: false,
    onSuccess: (result) => {
      committed.current = true;
      onSaved(result);
    },
  });
  const refresh = useMutation({
    mutationFn: () => getProject(project?.id ?? ''),
    onSuccess: (latest) => {
      setBase(latest);
      mutation.reset();
      setNotice(`현재 저장된 이름: ${latest.name}. 입력한 이름을 적용하려면 다시 저장하세요.`);
    },
  });
  const pending = mutation.isPending || refresh.isPending;
  const error =
    validation ||
    (mutation.isError
      ? errorMessage(mutation.error)
      : refresh.isError
        ? errorMessage(refresh.error)
        : '');
  function close() {
    if (!pending) onClose();
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent
        className="project-dialog"
        showCloseButton={!pending}
        onInteractOutside={(event) => event.preventDefault()}
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
            const value = name.trim();
            if (!value || Array.from(value).length > 80 || /\p{Cc}/u.test(value)) {
              setValidation('프로젝트 이름을 1~80자로 입력해 주세요.');
              return;
            }
            setValidation('');
            setNotice('');
            mutation.mutate(value);
          }}
        >
          <DialogTitle>{project ? '프로젝트 이름 변경' : '새 프로젝트'}</DialogTitle>
          <DialogDescription className="muted">
            {copy
              ? '이름과 마감일을 가져와 새 프로젝트를 만듭니다.'
              : '이 프로젝트는 사내 모든 접속자와 공유됩니다.'}
          </DialogDescription>
          <Label htmlFor={inputId}>프로젝트 이름</Label>
          <Input
            id={inputId}
            name="name"
            required
            maxLength={160}
            value={name}
            readOnly={pending}
            aria-invalid={!!validation}
            aria-describedby={errorId}
            placeholder="예: 2027 서비스 운영 제안"
            onChange={(event) => {
              setName(event.target.value);
              setValidation('');
            }}
          />
          <p className="field-hint">앞뒤 공백을 제외한 1~80자</p>
          {!project && (
            <>
              <Label htmlFor={dateId}>마감일</Label>
              <DueDatePicker
                id={dateId}
                value={dueDate}
                disabled={pending}
                required
                onChange={setDueDate}
              />
              <p className="field-hint">프로젝트 마감 날짜를 달력에서 선택하세요.</p>
            </>
          )}
          <div id={errorId} role="status" className={error ? 'form-message error' : 'form-message'}>
            {pending ? '저장 요청을 처리하고 있습니다.' : error || notice}
          </div>
          {mutation.error instanceof ApiError && mutation.error.code === 'revision_conflict' && (
            <Button variant="secondary" disabled={pending} onClick={() => refresh.mutate()}>
              최신 이름 확인
            </Button>
          )}
          <div className="dialog-actions">
            <Button variant="secondary" disabled={pending} onClick={close}>
              취소
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? '처리 중…' : project ? '저장' : '프로젝트 만들기'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
