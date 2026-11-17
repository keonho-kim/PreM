// Purpose: Confirm removing a project source from its shared active list.
// Pattern: shadcn owns focus/dismissal; the workspace owns the version-checked command.
// Usage: StudioWorkspace source menu.
// Related: studio-workspace.tsx, features/space/.
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
export function SourceRemoveDialog({
  open,
  title,
  pending,
  error,
  onClose,
  onRemove,
}: {
  open: boolean;
  title: string;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onRemove: () => void;
}) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(value) => {
        if (!value && !pending) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogTitle>이 문서를 프로젝트에서 제거할까요?</AlertDialogTitle>
        <AlertDialogDescription>
          {title}을 목록에서 숨깁니다. 이전 원본과 분석 기록은 보존합니다.
        </AlertDialogDescription>
        {error && <p role="alert">{error}</p>}
        <div className="dialog-actions">
          <AlertDialogCancel disabled={pending}>취소</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={(e) => {
              e.preventDefault();
              onRemove();
            }}
          >
            제거
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
