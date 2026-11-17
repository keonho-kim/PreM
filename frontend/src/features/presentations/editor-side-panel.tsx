// Purpose: Own the shared collapsible side-panel chrome without taking over feature state.
// Pattern: Radix owns disclosure semantics; force mounting preserves drafts and selected tabs.
// Usage: DeckPreview supplies left slide navigation and right task inspector contents.
// Related: editor-workbench.css, deck-preview.tsx, components/ui/collapsible.tsx.
import type { ReactNode } from 'react';
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
export function EditorSidePanel({
  side,
  open,
  onOpenChange,
  children,
}: {
  side: 'left' | 'right';
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const left = side === 'left',
    label = left ? '슬라이드 목록' : '슬라이드 정보 패널';
  const Icon = left
    ? open
      ? PanelLeftClose
      : PanelLeftOpen
    : open
      ? PanelRightClose
      : PanelRightOpen;
  return (
    <Collapsible className="presentation-panel-owner" open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={`presentation-${side}-toggle`}
          aria-label={`${label} ${open ? '접기' : '펼치기'}`}
          title={`${label} ${open ? '접기' : '펼치기'}`}
        >
          <Icon aria-hidden="true" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent forceMount hidden={!open} asChild>
        <aside
          className={left ? 'presentation-slide-panel' : 'presentation-inspector'}
          aria-label={left ? '슬라이드 목록 패널' : '현재 슬라이드 정보'}
        >
          {children}
        </aside>
      </CollapsibleContent>
    </Collapsible>
  );
}
