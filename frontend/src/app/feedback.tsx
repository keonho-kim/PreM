// Purpose: Place brief notifications above the initiating tab's persistent work panel.
// Pattern: One global Sonner host; measured panel height prevents overlapping fixed surfaces.
// Usage: Mounted inside app providers, outside route changes and modal contents.
// Related: shared/notifications.ts, features/space/index.ts, feedback.css.
import { lazy, Suspense, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Toaster } from '@/components/ui/sonner';
import { startNotifications } from '@/shared/notifications';
import { useWorkPanelState } from '@/shared/work-panel-state';
import './feedback.css';
const UploadWorkPanel = lazy(() =>
  import('@/features/space').then((module) => ({ default: module.UploadWorkPanel })),
);
export function Feedback() {
  const height = useWorkPanelState((state) => state.height);
  useEffect(startNotifications, []);
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--work-panel-reserve', height ? `${height + 12}px` : '0px');
    return () => {
      root.style.removeProperty('--work-panel-reserve');
    };
  }, [height]);
  const bottom = height
    ? `calc(var(--work-dock-gap) + ${height + 12}px)`
    : 'max(16px, env(safe-area-inset-bottom))';
  return (
    <>
      <Suspense fallback={null}>
        <UploadWorkPanel />
      </Suspense>
      {createPortal(
        <Toaster
          position="bottom-right"
          closeButton
          duration={5000}
          visibleToasts={1}
          containerAriaLabel="알림"
          offset={{ bottom, right: 'max(16px, env(safe-area-inset-right))' }}
          mobileOffset={{ bottom, right: '16px', left: '16px' }}
          toastOptions={{
            closeButtonAriaLabel: '알림 닫기',
            classNames: { toast: 'feedback-toast', description: 'feedback-toast-description' },
          }}
        />,
        document.body,
      )}
    </>
  );
}
