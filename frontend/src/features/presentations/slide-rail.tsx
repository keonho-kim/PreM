// Purpose: Present thumbnail navigation and accessible per-slide batch selection.
// Pattern: Explicit independent buttons; Ctrl/Command click is an optional shortcut.
// Usage: DeckPreview owns the current slide, batch scope and scrolling ref.
// Related: deck-preview.tsx, object-workbench.css.
import type { RefObject } from 'react';
import { AddSlide, SlideActions } from './slide-actions';
import type { CanvasOperation } from './canvas-api';
import { Check, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { previewUrl, type Slide, type Run } from './api';
export function SlideRail({
  project,
  run,
  items,
  current,
  targets,
  railRef,
  onSelectAll,
  onClear,
  onToggle,
  onPick,
  canEdit = false,
  onCommand,
}: {
  project: string;
  run: Run;
  items: Slide[];
  current: Slide | undefined;
  targets: Slide[];
  railRef: RefObject<HTMLElement | null>;
  onSelectAll: () => void;
  onClear: () => void;
  onToggle: (id: string) => void;
  onPick: (position: number) => void;
  canEdit?: boolean;
  onCommand?: (slide: string, operation: CanvasOperation) => void;
}) {
  return (
    <>
      {' '}
      <h3>
        슬라이드 <span>{items.length}</span>
      </h3>
      <div className="slide-batch-actions">
        <Button
          variant="ghost"
          onClick={() => {
            onSelectAll();
          }}
        >
          전체 선택
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            onClear();
          }}
        >
          선택 해제
        </Button>
        <AddSlide
          project={project}
          run={run.id}
          enabled={canEdit && items.length < 24}
          onApply={(op) => {
            if (current) onCommand?.(current.id, op);
          }}
        />
      </div>
      <p className="field-hint">{targets.length}장 수정 대상 · Ctrl/⌘ 클릭으로 추가</p>
      <nav ref={railRef} aria-label="생성한 슬라이드" className="presentation-thumbnails">
        {items.map((s) => (
          <SlideActions
            key={s.id}
            position={s.position}
            total={items.length}
            enabled={canEdit}
            onApply={(op) => onCommand?.(s.id, op)}
          >
            <div className="presentation-thumb-entry">
              <Button
                variant="ghost"
                className="presentation-slide-thumb"
                aria-label={`슬라이드 ${s.position}: ${s.spec?.title || '빈 슬라이드'}`}
                aria-pressed={s.id === current?.id}
                data-batch-selected={targets.some((t) => t.id === s.id)}
                onClick={(e) => {
                  if (e.ctrlKey || e.metaKey) {
                    onToggle(s.id);
                  } else {
                    onPick(s.position);
                  }
                }}
              >
                {s.preview && run.status === 'succeeded' ? (
                  <img src={previewUrl(project, run.id, s.id)} alt="" loading="lazy" />
                ) : (
                  <span className="presentation-thumb-placeholder">
                    {s.spec?.title || '빈 슬라이드'}
                  </span>
                )}
                <span className="presentation-thumb-caption">
                  <span>{String(s.position).padStart(2, '0')}</span>
                  <span>{s.spec?.title || '빈 슬라이드'}</span>
                </span>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="slide-batch-toggle"
                disabled={s.id === current?.id}
                aria-label={`슬라이드 ${s.position} 일괄 수정 선택`}
                aria-pressed={targets.some((t) => t.id === s.id)}
                onClick={() => onToggle(s.id)}
              >
                {targets.some((t) => t.id === s.id) ? (
                  <Check aria-hidden="true" />
                ) : (
                  <Plus aria-hidden="true" />
                )}
              </Button>
            </div>
          </SlideActions>
        ))}
      </nav>
    </>
  );
}
