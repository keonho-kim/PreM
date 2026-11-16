// Purpose: Verify toasts wait for modal input and release their queued work on cleanup.
// Pattern: Real MutationObserver with a controlled Sonner rendering boundary.
// Usage: Vitest alongside the persistent work panel interaction tests.
// Related: notifications.ts, app/feedback.tsx.
import { expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { notify, startNotifications } from './notifications';
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn(), dismiss: vi.fn() },
}));
it('defers new notices until an open dialog closes', async () => {
  const dialog = document.createElement('dialog');
  dialog.setAttribute('open', '');
  document.body.append(dialog);
  const stop = startNotifications();
  try {
    notify('완료');
    expect(toast.success).not.toHaveBeenCalled();
    dialog.removeAttribute('open');
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('완료'));
  } finally {
    stop();
    dialog.remove();
    vi.clearAllMocks();
  }
});
