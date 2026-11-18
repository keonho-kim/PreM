// Purpose: Display original chapter and subsection titles in their document order.
// Pattern: A single disclosure contains semantic nested lists from the saved processing revision.
// Usage: Original pages tab in both Studio source and Space reference viewers.
// Related: content.tsx, api.ts, documents/alignment/catalog.rs.
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import type { Detail } from './api';
export function SourceOutline({ entries }: { entries: Detail['source_outline'] }) {
  if (!entries?.length) return null;
  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button type="button" variant="ghost">
          원문 목차 · 대목차 {entries.length}개
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ol aria-label="원문 목차" className="source-outline-list">
          {entries.map((item) => (
            <li key={`${item.block}:${item.line}`}>
              {item.title}
              {item.printed != null && ` · ${item.printed}쪽`}
              {item.children?.length ? (
                <ol>
                  {item.children.map((c) => (
                    <li key={`${c.block}:${c.line}`}>
                      {c.title}
                      {c.printed != null && ` · ${c.printed}쪽`}
                    </li>
                  ))}
                </ol>
              ) : null}
            </li>
          ))}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  );
}
