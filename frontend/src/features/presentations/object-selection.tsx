// Purpose: Move/resize real slide objects with bounded direct gestures and accessible selection.
// Pattern: react-rnd owns drag listeners; local drafts commit once on release and Escape discards them.
// Usage: DeckCanvas supplies immutable frames and one explicit geometry command callback.
// Related: canvas-geometry.ts, canvas-controls.tsx, canvas-editing.css.
import { useEffect, useRef, useState } from 'react';
import { Rnd } from 'react-rnd';
import { Button } from '@/components/ui/button';
import type { SlideObject } from './slide-spec';
import { bounded, translated, changed, type Placements } from './canvas-geometry';
export function ObjectSelection({
  objects,
  selected,
  onSelect,
  enabled = false,
  onCommit,
  onDraft,
}: {
  objects: SlideObject[];
  selected: string[];
  onSelect: (id: string, multiple: boolean) => void;
  enabled?: boolean;
  onCommit?: (frames: Placements) => void;
  onDraft?: (frames: Placements) => void;
}) {
  const owner = useRef<HTMLFieldSetElement>(null),
    gesture = useRef<{ id: string; cancelled: boolean; ids: string[] } | null>(null),
    nodes = useRef(new Map<string, Rnd>());
  const suppressClick = useRef(false);
  const [size, setSize] = useState({ width: 0, height: 0 }),
    [draft, setDraft] = useState<Placements>({}),
    [message, setMessage] = useState('');
  function reset() {
    gesture.current = null;
    setDraft({});
    onDraft?.({});
    for (const o of objects) {
      nodes.current
        .get(o.id)
        ?.updatePosition({ x: (o.frame.x * size.width) / 100, y: (o.frame.y * size.height) / 100 });
    }
  }
  useEffect(() => {
    const element = owner.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && gesture.current) {
        event.preventDefault();
        gesture.current.cancelled = true;
        setDraft({});
        onDraft?.({});
        suppressClick.current = true;
        setMessage('배치 변경을 취소했습니다.');
      }
    };
    const blur = () => {
      if (gesture.current) {
        gesture.current.cancelled = true;
        setDraft({});
        onDraft?.({});
      }
    };
    const hidden = () => {
      if (document.hidden) blur();
    };
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('keydown', cancel);
    return () => {
      window.removeEventListener('keydown', cancel);
      window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [onDraft]);
  useEffect(() => {
    if (!enabled && gesture.current) {
      gesture.current.cancelled = true;
      setDraft({});
      onDraft?.({});
    }
  }, [enabled, onDraft]);
  useEffect(() => {
    if (enabled && selected.length && document.activeElement === document.body) {
      owner.current
        ?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')
        ?.focus({ preventScroll: true });
    }
  }, [enabled, selected]);
  function start(id: string, multiple: boolean) {
    if (!enabled || multiple) return false;
    const ids = selected.includes(id) ? selected : [id];
    if (!selected.includes(id)) onSelect(id, false);
    suppressClick.current = false;
    gesture.current = { id, ids, cancelled: false };
    return true;
  }
  function preview(frames: Placements) {
    setDraft(frames);
    onDraft?.(frames);
  }
  function finish(frames: Placements) {
    const current = gesture.current;
    gesture.current = null;
    if (!enabled || !current || current.cancelled || !changed(objects, frames)) {
      reset();
      return;
    }
    suppressClick.current = true;
    preview(frames);
    setMessage('배치를 저장하고 있습니다.');
    onCommit?.(frames);
  }
  return (
    <fieldset ref={owner} className="slide-object-selection" aria-label="장표 객체 선택">
      <p className="sr-only" role="status">
        {message}
      </p>
      {objects.map((o) => {
        const frame = draft[o.id] ?? o.frame,
          chosen = selected.includes(o.id);
        return (
          <Rnd
            key={o.id}
            ref={(n) => {
              if (n) nodes.current.set(o.id, n);
              else nodes.current.delete(o.id);
            }}
            className={`canvas-object-target ${chosen ? 'is-selected' : ''}`}
            bounds="parent"
            lockAspectRatio={o.content.kind === 'image' || o.content.kind === 'reference'}
            enableUserSelectHack={false}
            disableDragging={!enabled}
            position={{ x: (frame.x * size.width) / 100, y: (frame.y * size.height) / 100 }}
            size={{
              width: (frame.width * size.width) / 100,
              height: (frame.height * size.height) / 100,
            }}
            minWidth={Math.max(1, size.width / 100)}
            minHeight={Math.max(1, size.height / 100)}
            dragHandleClassName="canvas-object-handle"
            enableResizing={
              enabled && chosen && selected.length === 1
                ? { topLeft: true, topRight: true, bottomLeft: true, bottomRight: true }
                : false
            }
            resizeHandleStyles={{
              topLeft: { left: -22, top: -22 },
              topRight: { right: -22, top: -22 },
              bottomLeft: { left: -22, bottom: -22 },
              bottomRight: { right: -22, bottom: -22 },
            }}
            resizeHandleClasses={{
              topLeft: 'canvas-resize-handle',
              topRight: 'canvas-resize-handle',
              bottomLeft: 'canvas-resize-handle',
              bottomRight: 'canvas-resize-handle',
            }}
            onDragStart={(e) => {
              if (!start(o.id, 'ctrlKey' in e && (e.ctrlKey || e.metaKey))) return false;
            }}
            onDrag={(_e, d) => {
              if (gesture.current?.cancelled) return false;
              preview(
                translated(
                  objects,
                  gesture.current?.ids ?? [o.id],
                  (d.x / size.width) * 100 - o.frame.x,
                  (d.y / size.height) * 100 - o.frame.y,
                ),
              );
            }}
            onDragStop={(_e, d) =>
              finish(
                translated(
                  objects,
                  gesture.current?.ids ?? [o.id],
                  (d.x / size.width) * 100 - o.frame.x,
                  (d.y / size.height) * 100 - o.frame.y,
                ),
              )
            }
            onResizeStart={() => start(o.id, false)}
            onResize={(_e, _direction, element, _delta, pos) => {
              if (gesture.current?.cancelled) return;
              preview({
                [o.id]: bounded({
                  ...o.frame,
                  x: (pos.x / size.width) * 100,
                  y: (pos.y / size.height) * 100,
                  width: (element.offsetWidth / size.width) * 100,
                  height: (element.offsetHeight / size.height) * 100,
                }),
              });
            }}
            onResizeStop={(_e, _direction, element, _delta, pos) =>
              finish({
                [o.id]: bounded({
                  ...o.frame,
                  x: (pos.x / size.width) * 100,
                  y: (pos.y / size.height) * 100,
                  width: (element.offsetWidth / size.width) * 100,
                  height: (element.offsetHeight / size.height) * 100,
                }),
              })
            }
          >
            <Button
              variant="ghost"
              className="canvas-object-handle"
              aria-label={`${o.name} 선택`}
              aria-pressed={chosen}
              style={{ transform: `rotate(${o.frame.rotation}deg)` }}
              onClick={(e) => {
                if (suppressClick.current) {
                  suppressClick.current = false;
                  return;
                }
                if (!gesture.current) onSelect(o.id, e.ctrlKey || e.metaKey);
              }}
              onKeyDown={(e) => {
                const delta: Record<string, [number, number]> = {
                  ArrowLeft: [-1, 0],
                  ArrowRight: [1, 0],
                  ArrowUp: [0, -1],
                  ArrowDown: [0, 1],
                };
                const d = delta[e.key];
                if (!enabled || !d || e.nativeEvent.isComposing) return;
                e.preventDefault();
                const ids = selected.includes(o.id) ? selected : [o.id];
                if (!selected.includes(o.id)) onSelect(o.id, false);
                const frames = translated(
                  objects,
                  ids,
                  d[0] * (e.shiftKey ? 5 : 1),
                  d[1] * (e.shiftKey ? 5 : 1),
                );
                if (changed(objects, frames)) {
                  preview(frames);
                  onCommit?.(frames);
                }
              }}
            >
              <span>{o.name}</span>
            </Button>
          </Rnd>
        );
      })}
    </fieldset>
  );
}
