// Purpose: Place compare/undo beside the canvas zoom controls rather than inside conversation.
// Pattern: Lucide icons, shadcn buttons and explicit hold behavior; mobile retains history actions.
// Usage: DeckPreview owns navigation/zoom/preview state and supplies server undo availability.
// Related: comparison-button.tsx, history-api.ts, deck-review.css.
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ComparisonButton } from './comparison-button';
export function CanvasToolbar({
  index,
  total,
  zoom,
  onPrevious,
  onNext,
  onZoom,
  scope,
  canCompare,
  held,
  onHold,
  undoRemaining,
  canUndo,
  onUndo,
}: {
  index: number;
  total: number;
  zoom: number;
  onPrevious: () => void;
  onNext: () => void;
  onZoom: (value: number) => void;
  scope: string;
  canCompare: boolean;
  held: boolean;
  onHold: (held: boolean) => void;
  undoRemaining: number;
  canUndo: boolean;
  onUndo: () => void;
}) {
  return (
    <section className="presentation-canvas-tools" aria-label="슬라이드 보기 도구">
      <div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="이전 슬라이드"
          title="이전 슬라이드"
          disabled={index <= 0}
          onClick={onPrevious}
        >
          <ChevronLeft aria-hidden="true" />
        </Button>
        <span>
          {index + 1} / {total}
        </span>
        <Button
          variant="ghost"
          size="icon"
          aria-label="다음 슬라이드"
          title="다음 슬라이드"
          disabled={index < 0 || index >= total - 1}
          onClick={onNext}
        >
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
      <div className="presentation-toolbar-actions">
        <div className="presentation-history-tools">
          <ComparisonButton key={scope} disabled={!canCompare} held={held} onHold={onHold} />
          <Button
            variant="ghost"
            size="icon"
            aria-label="이전 상태로 되돌리기"
            title={`발표자료 전체를 이전 상태로 되돌리기 · ${undoRemaining}/3단계 가능`}
            disabled={!canUndo || undoRemaining === 0 || held}
            onClick={onUndo}
          >
            <Undo2 aria-hidden="true" />
          </Button>
          <span
            className="field-hint"
            role="status"
            aria-label={`되돌리기 ${undoRemaining}단계 가능`}
          >
            {undoRemaining}/3
          </span>
        </div>
        <div className="presentation-zoom">
          <Button
            variant="ghost"
            size="icon"
            aria-label="슬라이드 축소"
            title="슬라이드 축소"
            disabled={zoom <= 50}
            onClick={() => onZoom(zoom - 25)}
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
            onClick={() => onZoom(zoom + 25)}
          >
            <ZoomIn aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="화면에 맞추기"
            title="화면에 맞추기"
            onClick={() => onZoom(100)}
          >
            <Maximize aria-hidden="true" />
          </Button>
        </div>
      </div>
    </section>
  );
}
