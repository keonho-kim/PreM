// Purpose: Queue brief public notifications until modal input has finished.
// Pattern: Sonner owns toast rendering/lifetime; this bounded queue only defers blocked notices.
// Usage: Features call notify; the single app feedback host owns start/cleanup.
// Related: app/feedback.tsx, components/ui/sonner.tsx, features/space/upload-work-panel.tsx.
import { toast } from 'sonner';
type Kind = 'success' | 'error' | 'info';
const pending: { message: string; kind: Kind }[] = [];
let running = false;
function flush() {
  if (
    !running ||
    document.querySelector(
      'dialog[open], [role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
    )
  )
    return;
  for (const notice of pending.splice(0)) toast[notice.kind](notice.message);
}
export function notify(message: string, kind: Kind = 'success') {
  pending.push({ message, kind });
  if (pending.length > 10) pending.shift();
  flush();
}
export function startNotifications() {
  running = true;
  const observer = new MutationObserver(flush);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['open', 'data-state'],
  });
  flush();
  return () => {
    running = false;
    observer.disconnect();
    pending.length = 0;
    toast.dismiss();
  };
}
