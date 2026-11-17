// Purpose: Show this tab's durable upload outcomes in a collapsible bottom-right work panel.
// Pattern: Uppy owns tasks; Redux shares panel presentation with the notification host.
// Usage: App Feedback mounts once across routes; closing never cancels an upload.
// Related: upload-panel.tsx, use-upload-engine.ts, shared/notifications.ts, app/feedback.css.
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useUppyState } from '@uppy/react';
import { ChevronDown, ChevronUp, ListTodo, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { notify } from '@/shared/notifications';
import { useWorkPanel } from '@/shared/work-panel-state';
import { useUploadEngine } from './use-upload-engine';
import { UploadPanel } from './upload-panel';
import type { UploadFile } from './upload-engine';
import './upload-work-panel.css';
export function UploadWorkPanel() {
  const engine = useUploadEngine();
  const files = useUppyState(engine.uppy, (state) => Object.values(state.files));
  const { view, setView, setHeight: onHeightChange } = useWorkPanel();
  const region = useRef<HTMLElement>(null),
    toggle = useRef<HTMLButtonElement>(null),
    focusRequested = useRef(false);
  const complete = files.filter((file) => file.progress.uploadComplete).length;
  const failed = files.filter((file) => !file.progress.uploadComplete && file.error).length;
  const active = files.length - complete - failed;
  const present = files.length > 0;
  useEffect(() => {
    const added = () => setView('expanded');
    const saved = (file: UploadFile | undefined) => {
      if (file) notify(`${file.name} 등록 완료`);
    };
    const failure = (file: UploadFile | undefined) => {
      if (file) notify(`${file.name} 등록 실패. 작업 패널에서 다시 시도하세요.`, 'error');
    };
    engine.uppy.on('file-added', added).on('upload-success', saved).on('upload-error', failure);
    return () => {
      engine.uppy
        .off('file-added', added)
        .off('upload-success', saved)
        .off('upload-error', failure);
    };
  }, [engine, setView]);
  useEffect(() => {
    if (!present || !region.current) {
      onHeightChange(0);
      return;
    }
    const element = region.current;
    const measure = () => onHeightChange(Math.ceil(element.getBoundingClientRect().height));
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => {
      observer.disconnect();
      onHeightChange(0);
    };
  }, [present, onHeightChange]);
  function change(next: typeof view) {
    focusRequested.current = true;
    setView(next);
  }
  useEffect(() => {
    if (focusRequested.current) {
      (view === 'hidden'
        ? region.current?.querySelector<HTMLButtonElement>('button')
        : toggle.current
      )?.focus();
      focusRequested.current = false;
    }
  }, [view]);
  return createPortal(
    <>
      <span className="sr-only" role="status">
        {present ? `업로드 진행 ${active}개 · 완료 ${complete}개 · 실패 ${failed}개` : ''}
      </span>
      {present && (
        <section ref={region} className="work-dock" aria-label="작업 진행 상황">
          {view === 'hidden' ? (
            <Button
              className="work-launcher"
              variant="secondary"
              onClick={() => change('expanded')}
            >
              <ListTodo aria-hidden="true" />
              작업 {files.length}개 보기
            </Button>
          ) : (
            <Collapsible
              open={view === 'expanded'}
              onOpenChange={(open) => change(open ? 'expanded' : 'collapsed')}
              className="work-panel"
            >
              <header className="work-panel-heading">
                <div>
                  <h2>
                    업로드 {active ? `${active}개 진행 중` : failed ? `${failed}개 실패` : '완료'}
                  </h2>
                  <p>
                    완료 {complete} · 전체 {files.length}
                  </p>
                </div>
                <CollapsibleTrigger asChild>
                  <Button
                    ref={toggle}
                    variant="ghost"
                    size="icon"
                    title={view === 'expanded' ? '작업 패널 접기' : '작업 패널 펼치기'}
                    aria-label={view === 'expanded' ? '작업 패널 접기' : '작업 패널 펼치기'}
                  >
                    {view === 'expanded' ? (
                      <ChevronDown aria-hidden="true" />
                    ) : (
                      <ChevronUp aria-hidden="true" />
                    )}
                  </Button>
                </CollapsibleTrigger>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="작업 패널 닫기"
                  title="작업 패널 닫기"
                  onClick={() => change('hidden')}
                >
                  <X aria-hidden="true" />
                </Button>
              </header>
              <CollapsibleContent className="work-panel-body">
                <UploadPanel engine={engine} />
              </CollapsibleContent>
            </Collapsible>
          )}
        </section>
      )}
    </>,
    document.body,
  );
}
