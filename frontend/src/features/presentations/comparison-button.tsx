// Purpose: Show the previous slide only while a pointer or keyboard activation is held.
// Pattern: Native pointer capture with release/cancel/focus/visibility cleanup; no sticky toggle.
// Usage: Key by comparison scope so slide/revision changes immediately end the held preview.
// Related: canvas-toolbar.tsx, deck-review.css, comparison-button.test.tsx.
import { useEffect, useRef } from 'react';
import { SquareSplitHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
export function ComparisonButton({
  disabled,
  held,
  onHold,
}: {
  disabled: boolean;
  held: boolean;
  onHold: (value: boolean) => void;
}) {
  const pointer = useRef<number | null>(null),
    key = useRef<string | null>(null),
    callback = useRef(onHold);
  callback.current = onHold;
  useEffect(() => {
    const stop = () => {
      pointer.current = null;
      key.current = null;
      callback.current(false);
    };
    const hidden = () => {
      if (document.hidden) stop();
    };
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    window.addEventListener('blur', stop);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      stop();
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      window.removeEventListener('blur', stop);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, []);
  const stop = () => {
    pointer.current = null;
    key.current = null;
    onHold(false);
  };
  return (
    <Button
      variant="ghost"
      size="icon"
      className="presentation-compare"
      aria-label="누르고 이전 장표 보기"
      aria-pressed={held}
      title="누르고 있는 동안 수정 전 보기 · Space 또는 Enter"
      disabled={disabled}
      onPointerDown={(e) => {
        if (e.button !== 0 || e.isPrimary === false || disabled) return;
        pointer.current = e.pointerId;
        e.currentTarget.focus();
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* Window release listeners cover missing capture support. */
        }
        onHold(true);
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onBlur={stop}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key === 'Escape' || e.key === 'Tab') {
          stop();
          return;
        }
        if ((e.key === ' ' || e.key === 'Enter') && !e.nativeEvent.isComposing && !disabled) {
          e.preventDefault();
          if (!e.repeat) {
            key.current = e.key;
            onHold(true);
          }
        }
      }}
      onKeyUp={(e) => {
        if (e.key === key.current) {
          e.preventDefault();
          stop();
        }
      }}
      onClick={(e) => e.preventDefault()}
    >
      <SquareSplitHorizontal aria-hidden="true" />
    </Button>
  );
}
