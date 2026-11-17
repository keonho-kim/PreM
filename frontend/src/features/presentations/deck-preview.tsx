// Purpose: Review real slides in the mock's three-pane workbench with independent panel controls.
// Pattern: Radix owns disclosure semantics; forced mounting preserves selection and inspector tabs.
// Usage: Generation supplies a pinned run; this view does not pretend to edit PPT objects.
// Related: deck-inspector.tsx, editor-workbench.css, api.ts.
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { EditorSidePanel } from './editor-side-panel';
import type { CanvasOperation } from './canvas-api';
import { listSlides, presentationKeys, type Run } from './api';
import { errorMessage } from '@/shared/api/http';
import { useEditThread } from './use-edit-thread';
import { useEditorSession } from './use-editor-session';
import { useCanvasCommand } from './use-canvas-command';
import { CanvasControls } from './canvas-controls';
import { useDeckReview } from './use-deck-review';
import { CanvasToolbar } from './canvas-toolbar';
import { DeckInspector } from './deck-inspector';
import { SlideRail } from './slide-rail';
import { DeckCanvas } from './deck-canvas';
import './editor-workbench.css';
import './object-workbench.css';
import './deck-review.css';
export function DeckPreview({
  project,
  run,
  active,
  canEdit,
  onResult,
}: {
  project: string;
  run: Run;
  active: boolean;
  canEdit: boolean;
  onResult: (id: string) => void;
}) {
  const [selected, setSelected] = useState(1),
    [left, setLeft] = useState(true),
    [right, setRight] = useState(true),
    [zoom, setZoom] = useState(100);
  const [batch, setBatch] = useState<{ run: string; ids: string[] }>({ run: run.id, ids: [] }),
    [objects, setObjects] = useState<{ slide: string; ids: string[] }>({ slide: '', ids: [] });
  const rail = useRef<HTMLElement>(null);
  const slides = useQuery({
    queryKey: [...presentationKeys.slides(project, run.id), run.version],
    queryFn: ({ signal }) => listSlides(project, run.id, signal),
    enabled: active,
    placeholderData: (previous, query) => (query?.queryKey[2] === run.id ? previous : undefined),
  });
  const items = slides.data ?? [],
    current = items.find((s) => s.position === selected) ?? items[0],
    index = items.findIndex((s) => s.id === current?.id);
  const thread = useEditThread(project, run, current, active);
  const session = useEditorSession(project, run, active);
  const review = useDeckReview(
    project,
    run,
    current,
    active,
    canEdit,
    thread,
    session.id,
    onResult,
  );
  const pendingSelection = useRef<{ position: number; ids: string[] } | null>(null);
  const canvas = useCanvasCommand(project, run, session.id, active, (id) => {
    if (id !== run.id && pendingSelection.current) {
      const next = pendingSelection.current;
      setSelected(next.position);
      setObjects({ slide: `${run.presentation_id}:${next.position}`, ids: next.ids });
      pendingSelection.current = null;
    }
    onResult(id);
  });
  const applyDirect = (slide: string, operation: CanvasOperation) => {
    const source = items.find((s) => s.id === slide);
    if (!source) return;
    const position =
      operation.kind === 'move_slide'
        ? operation.position
        : operation.kind === 'add_slide' || operation.kind === 'duplicate_slide'
          ? source.position + 1
          : operation.kind === 'delete_slide'
            ? Math.min(source.position, items.length - 1)
            : source.position;
    pendingSelection.current = {
      position,
      ids:
        operation.kind === 'insert'
          ? [operation.object.id]
          : operation.kind === 'geometry' || operation.kind === 'text'
            ? objectIds
            : [],
    };
    canvas.apply(slide, operation);
  };
  const direct =
    active &&
    canEdit &&
    run.is_current &&
    run.status === 'succeeded' &&
    !review.proposal &&
    !!session.id &&
    !canvas.busy &&
    !thread.data?.some((e) => ['queued', 'running', 'applying'].includes(e.status));
  const [holding, setHolding] = useState<string | null>(null),
    [beforeLoaded, setBeforeLoaded] = useState<string | null>(null);
  const comparisonScope = `${run.id}:${current?.id}:${review.proposal?.id ?? 'saved'}`;
  const canCompare = !!review.beforeUrl && beforeLoaded === review.beforeUrl;
  const comparing = active && canCompare && holding === comparisonScope;
  const displayed = current && review.proposed ? { ...current, spec: review.proposed } : current;
  const chosen = batch.run === run.id ? batch.ids : [];
  const targets = items.filter((s) => s.id === current?.id || chosen.includes(s.id));
  const objectScope = `${run.presentation_id}:${current?.position}`;
  const objectIds =
    objects.slide === objectScope
      ? objects.ids.filter((id) => current?.spec?.objects?.some((o) => o.id === id))
      : [];
  const selectObject = (id: string, multiple: boolean) => {
    setBatch({ run: run.id, ids: [] });
    setObjects({
      slide: objectScope,
      ids: !id
        ? []
        : multiple
          ? objectIds.includes(id)
            ? objectIds.filter((v) => v !== id)
            : [...objectIds, id]
          : [id],
    });
  };
  const toggleSlide = (id: string) => {
    setObjects({ slide: '', ids: [] });
    setBatch({
      run: run.id,
      ids: chosen.includes(id) ? chosen.filter((v) => v !== id) : [...chosen, id],
    });
  };
  useEffect(() => {
    const reveal = () => {
      if (!left || !active || !current?.id) return;
      const region = rail.current,
        button = region?.querySelector<HTMLElement>('[aria-pressed="true"]');
      if (!region || !button) return;
      const view = region.getBoundingClientRect(),
        item = button.getBoundingClientRect();
      if (window.matchMedia('(max-width: 640px)').matches) {
        if (item.left < view.left) region.scrollLeft += item.left - view.left;
        else if (item.right > view.right) region.scrollLeft += item.right - view.right;
      } else {
        if (item.top < view.top) region.scrollTop += item.top - view.top;
        else if (item.bottom > view.bottom) region.scrollTop += item.bottom - view.bottom;
      }
    };
    reveal();
    window.addEventListener('resize', reveal);
    return () => window.removeEventListener('resize', reveal);
  }, [current?.id, left, active]);
  if (slides.isPending) return <p role="status">슬라이드를 불러옵니다.</p>;
  if (slides.isError)
    return (
      <p role="alert">
        {errorMessage(slides.error)}{' '}
        <Button variant="secondary" onClick={() => void slides.refetch()}>
          다시 시도
        </Button>
      </p>
    );
  return (
    <div className="presentation-deck" data-left-open={left} data-right-open={right}>
      <EditorSidePanel side="left" open={left} onOpenChange={setLeft}>
        <SlideRail
          project={project}
          run={run}
          items={items}
          current={current}
          targets={targets}
          railRef={rail}
          canEdit={direct}
          onCommand={applyDirect}
          onSelectAll={() => {
            setObjects({ slide: '', ids: [] });
            setBatch({ run: run.id, ids: items.map((s) => s.id) });
          }}
          onClear={() => {
            setObjects({ slide: '', ids: [] });
            setBatch({ run: run.id, ids: [] });
          }}
          onToggle={toggleSlide}
          onPick={(position) => {
            setSelected(position);
            setBatch({ run: run.id, ids: [] });
          }}
        />
      </EditorSidePanel>
      <CanvasToolbar
        index={index}
        total={items.length}
        zoom={zoom}
        onPrevious={() => {
          const s = items[index - 1];
          if (s) setSelected(s.position);
        }}
        onNext={() => {
          const s = items[index + 1];
          if (s) setSelected(s.position);
        }}
        onZoom={setZoom}
        scope={comparisonScope}
        canCompare={canCompare}
        held={comparing}
        onHold={(value) => setHolding(value ? comparisonScope : null)}
        undoRemaining={review.undoRemaining}
        canUndo={review.canUndo}
        onUndo={() => review.undo.mutate()}
      />
      <section className="presentation-slide-reader" aria-label="슬라이드 미리보기">
        {!!session.error && (
          <p role="alert">
            편집 연결이 종료되었습니다.{' '}
            <Button variant="ghost" onClick={session.retry}>
              편집 다시 연결
            </Button>
          </p>
        )}
        {review.history.isError && (
          <p role="alert">
            {errorMessage(review.history.error)}{' '}
            <Button variant="ghost" onClick={() => void review.history.refetch()}>
              이력 다시 확인
            </Button>
          </p>
        )}
        {review.undo.isError && <p role="alert">{errorMessage(review.undo.error)}</p>}
        {review.undo.isPending && <p role="status">이전 상태로 되돌리고 있습니다.</p>}
        {current && (
          <CanvasControls
            key={`${run.id}:${current.id}`}
            project={project}
            objects={current.spec?.objects ?? []}
            selected={objectIds}
            enabled={direct}
            onApply={(op) => applyDirect(current.id, op)}
          />
        )}
        {canvas.busy && <p role="status">변경한 배치를 적용하고 있습니다.</p>}
        {canvas.error && <p role="alert">{canvas.error}</p>}
        <DeckCanvas
          key={`${run.id}:${current?.id}:${canvas.error}`}
          layerScope={{ project, run: run.id }}
          editable={direct}
          onGeometry={(placements) => {
            if (current)
              applyDirect(current.id, {
                kind: 'geometry',
                placements: Object.entries(placements).map(([object_id, frame]) => ({
                  object_id,
                  frame,
                })),
              });
          }}
          current={current}
          displayed={displayed}
          published={run.status === 'succeeded'}
          beforeUrl={review.beforeUrl}
          afterUrl={review.afterUrl}
          comparing={comparing}
          proposal={!!review.proposal}
          zoom={zoom}
          selectedObjects={objectIds}
          onSelect={selectObject}
          onBeforeReady={setBeforeLoaded}
        />
      </section>
      <EditorSidePanel side="right" open={right} onOpenChange={setRight}>
        <DeckInspector
          project={project}
          run={run}
          slide={displayed}
          history={thread}
          session={session.id}
          previewing={!!review.proposal}
          canEdit={canEdit}
          targetSlides={targets}
          objectIds={objectIds}
          onObjectSelect={selectObject}
          active={active && right}
          onResult={onResult}
        />
      </EditorSidePanel>
    </div>
  );
}
