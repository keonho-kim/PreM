// Purpose: Review real slides in the mock's three-pane workbench with independent panel controls.
// Pattern: Radix owns disclosure semantics; forced mounting preserves selection and inspector tabs.
// Usage: Generation supplies a pinned run; this view does not pretend to edit PPT objects.
// Related: deck-inspector.tsx, editor-workbench.css, api.ts.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Maximize,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { listSlides, previewUrl, presentationKeys, type Run } from './api';
import { errorMessage } from '@/shared/api/http';
import { DeckInspector } from './deck-inspector';
import './editor-workbench.css';
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
    [zoom, setZoom] = useState(100),
    [ratio, setRatio] = useState(16 / 9);
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
      <Collapsible className="presentation-panel-owner" open={left} onOpenChange={setLeft}>
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="presentation-left-toggle"
            aria-label={left ? '슬라이드 목록 접기' : '슬라이드 목록 펼치기'}
            title={left ? '슬라이드 목록 접기' : '슬라이드 목록 펼치기'}
          >
            {left ? <PanelLeftClose aria-hidden="true" /> : <PanelLeftOpen aria-hidden="true" />}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent forceMount hidden={!left} asChild>
          <aside className="presentation-slide-panel" aria-label="슬라이드 목록 패널">
            <h3>
              슬라이드 <span>{items.length}</span>
            </h3>
            <nav ref={rail} aria-label="생성한 슬라이드" className="presentation-thumbnails">
              {items.map((s) => (
                <Button
                  key={s.id}
                  variant="ghost"
                  className="presentation-slide-thumb"
                  aria-label={`슬라이드 ${s.position}: ${s.spec?.title ?? '내용 작성 대기'}`}
                  aria-pressed={s.id === current?.id}
                  onClick={() => setSelected(s.position)}
                >
                  {s.preview && run.status === 'succeeded' ? (
                    <img src={previewUrl(project, run.id, s.id)} alt="" loading="lazy" />
                  ) : (
                    <span className="presentation-thumb-placeholder">
                      {s.spec?.title ?? '내용 작성 대기'}
                    </span>
                  )}
                  <span className="presentation-thumb-caption">
                    <span>{String(s.position).padStart(2, '0')}</span>
                    <span>{s.spec?.title ?? '내용 작성 대기'}</span>
                  </span>
                </Button>
              ))}
            </nav>
          </aside>
        </CollapsibleContent>
      </Collapsible>
      <section className="presentation-canvas-tools" aria-label="슬라이드 보기 도구">
        <div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="이전 슬라이드"
            title="이전 슬라이드"
            disabled={index <= 0}
            onClick={() => {
              const previous = items[index - 1];
              if (previous) setSelected(previous.position);
            }}
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <span>
            {index + 1} / {items.length}
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label="다음 슬라이드"
            title="다음 슬라이드"
            disabled={index < 0 || index >= items.length - 1}
            onClick={() => {
              const next = items[index + 1];
              if (next) setSelected(next.position);
            }}
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
        <div className="presentation-zoom">
          <Button
            variant="ghost"
            size="icon"
            aria-label="슬라이드 축소"
            title="슬라이드 축소"
            disabled={zoom <= 50}
            onClick={() => setZoom(zoom - 25)}
          >
            <ZoomOut aria-hidden="true" />
          </Button>
          <span>{zoom}%</span>
          <Button
            variant="ghost"
            size="icon"
            aria-label="슬라이드 확대"
            title="슬라이드 확대"
            disabled={zoom >= 150}
            onClick={() => setZoom(zoom + 25)}
          >
            <ZoomIn aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="화면에 맞추기"
            title="화면에 맞추기"
            onClick={() => setZoom(100)}
          >
            <Maximize aria-hidden="true" />
          </Button>
        </div>
      </section>
      <section className="presentation-slide-reader" aria-label="슬라이드 미리보기">
        <div className="presentation-canvas-well">
          <div
            className="presentation-canvas-paper"
            style={{ '--preview-ratio': ratio, '--preview-zoom': zoom / 100 } as CSSProperties}
          >
            {current?.preview && run.status === 'succeeded' ? (
              // biome-ignore lint/a11y/noNoninteractiveElementInteractions: Load measures the passive image aspect ratio, not a user interaction.
              <img
                className="presentation-output"
                onLoad={(e) => {
                  const image = e.currentTarget;
                  if (image.naturalHeight) setRatio(image.naturalWidth / image.naturalHeight);
                }}
                src={previewUrl(project, run.id, current.id)}
                alt={current.spec?.title ?? '생성한 슬라이드'}
              />
            ) : current?.spec ? (
              <article className="presentation-draft">
                <p className="field-hint">내용 초안 · 완성 전</p>
                <h3>{current.spec.title}</h3>
                <ul>
                  {current.spec.bullets.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </article>
            ) : (
              <p className="related-empty">슬라이드 내용이 준비되면 이곳에 표시됩니다.</p>
            )}
          </div>
        </div>
        <p className="presentation-canvas-caption">
          {current?.spec?.title ?? '슬라이드 내용 준비 중'}
        </p>
      </section>
      <Collapsible className="presentation-panel-owner" open={right} onOpenChange={setRight}>
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="presentation-right-toggle"
            aria-label={right ? '슬라이드 정보 패널 접기' : '슬라이드 정보 패널 펼치기'}
            title={right ? '슬라이드 정보 패널 접기' : '슬라이드 정보 패널 펼치기'}
          >
            {right ? <PanelRightClose aria-hidden="true" /> : <PanelRightOpen aria-hidden="true" />}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent forceMount hidden={!right} asChild>
          <aside className="presentation-inspector" aria-label="현재 슬라이드 정보">
            <DeckInspector
              project={project}
              run={run}
              slide={current}
              canEdit={canEdit}
              active={active && right}
              onResult={onResult}
            />
          </aside>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
