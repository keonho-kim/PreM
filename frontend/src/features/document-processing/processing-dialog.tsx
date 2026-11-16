// Purpose: Frame a quick asset preview with shadcn focus and dismissal ownership.
// Pattern: The shared ProcessingView owns content and commands; this wrapper owns the dialog.
// Usage: Existing source/library quick previews pass their return-focus trigger.
// Related: processing-view.tsx, pages/document-page.tsx.
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { ProcessingView, type Target } from './processing-view';
export function ProcessingDialog({
  item,
  onClose,
  returnFocus,
}: {
  item: Target;
  onClose: () => void;
  returnFocus?: HTMLElement;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="processing-dialog"
        onCloseAutoFocus={(e) => {
          if (returnFocus?.isConnected) {
            e.preventDefault();
            returnFocus.focus();
          }
        }}
      >
        <ProcessingView item={item} />
      </DialogContent>
    </Dialog>
  );
}
