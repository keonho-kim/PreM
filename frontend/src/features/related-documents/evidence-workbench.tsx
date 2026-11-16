// Purpose: Review candidates in viewport-sized panes or a single mobile detail view.
// Pattern: Local reading state with measured chrome and explicit focus/scroll restoration.
// Usage: RelatedResults supplies canonical rows and the existing selection command.
// Related: evidence.tsx, result-row.tsx, evidence-workbench.css.
import { useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { RelatedItem } from './api';
import { Evidence } from './evidence';
import { ResultRow } from './result-row';
import './evidence-workbench.css';
export function EvidenceWorkbench({
  project,
  items,
  query,
  editable,
  stale,
  pending,
  active,
  onSelect,
}: {
  project: string;
  items: RelatedItem[];
  query: string;
  editable: boolean;
  stale: boolean;
  pending: boolean;
  active: boolean;
  onSelect: (item: RelatedItem) => void;
}) {
  const [focused, setFocused] = useState<string | null>(null);
  const [detail, setDetail] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLElement>(null);
  const reader = useRef<HTMLElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  const origin = useRef<{ button: HTMLButtonElement; scroll: number } | null>(null);
  const wasDetail = useRef(false);
  const inspected = items.find((item) => item.id === focused);
  const showingDetail = detail && !!inspected && active;
  useLayoutEffect(() => {
    const header = document.querySelector('.app-header');
    if (!header) return;
    const measure = () =>
      root.current?.style.setProperty(
        '--evidence-header-height',
        `${header.getBoundingClientRect().height}px`,
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const mobile = window.matchMedia('(max-width: 900px)');
    const update = () => {
      if (showingDetail && mobile.matches) {
        back.current?.focus({ preventScroll: true });
        reader.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
        wasDetail.current = true;
      } else if (wasDetail.current) {
        if (active && mobile.matches) {
          const target = origin.current?.button;
          (target?.isConnected ? target : list.current)?.focus({ preventScroll: true });
          window.scrollTo({ top: origin.current?.scroll ?? 0, behavior: 'instant' });
        } else if (active && !mobile.matches && document.activeElement === back.current) {
          reader.current?.focus({ preventScroll: true });
        }
        wasDetail.current = false;
      }
    };
    update();
    mobile.addEventListener('change', update);
    return () => mobile.removeEventListener('change', update);
  }, [showingDetail, active]);
  return (
    <div ref={root} className="evidence-workbench" data-detail={showingDetail}>
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: Named scroll pane needs keyboard scrolling. */}
      <section ref={list} className="related-results" aria-label="근거 후보 목록" tabIndex={0}>
        {items.map((item) => (
          <ResultRow
            key={item.selection_id}
            project={project}
            item={item}
            query={query}
            disabled={!editable || (stale && !item.selected)}
            pending={pending}
            inspected={item.id === focused}
            onInspect={(value, button) => {
              origin.current = { button, scroll: window.scrollY };
              setFocused(value.id);
              setDetail(true);
              reader.current?.scrollTo({ top: 0, behavior: 'instant' });
              if (!window.matchMedia('(max-width: 900px)').matches)
                root.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
            }}
            onSelect={onSelect}
          />
        ))}
      </section>
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: Named scroll pane needs keyboard scrolling. */}
      <aside ref={reader} className="evidence-reader" aria-label="근거 내용 확인" tabIndex={0}>
        <Button
          ref={back}
          variant="ghost"
          className="evidence-back"
          onClick={() => setDetail(false)}
        >
          <ArrowLeft aria-hidden="true" />
          목록으로
        </Button>
        {inspected ? (
          <Evidence
            key={focused}
            project={project}
            item={inspected}
            disabled={!editable || pending || (stale && !inspected.selected)}
            onSelect={onSelect}
          />
        ) : (
          <div className="evidence-reader-empty">
            <h3>근거 내용 확인</h3>
            <p>자료 제목을 선택하면 원문과 비교 자료를 이곳에서 검토할 수 있습니다.</p>
          </div>
        )}
      </aside>
    </div>
  );
}
