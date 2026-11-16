// Purpose: Highlight actual query matches without interpreting document text as markup.
// Pattern: Owned Custom Highlight ranges; semantic React mark fallback for unsupported browsers.
// Usage: Result excerpts; cleanup removes this component's ranges without clearing other features.
// Related: features/search/, features/related-documents/, match-text.css.
import { useEffect, useRef } from 'react';
import './match-text.css';
function pattern(query: string) {
  const terms = [...new Set(query.split(/[^\p{L}\p{N}]+/u).filter((s) => s.length >= 1))].slice(
    0,
    8,
  );
  return terms.length
    ? new RegExp(terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'giu')
    : null;
}
export function MatchText({ text, query }: { text: string; query: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const supported =
    typeof CSS !== 'undefined' && !!CSS.highlights && typeof Highlight !== 'undefined';
  useEffect(() => {
    if (!text || !supported || !ref.current) return;
    const regex = pattern(query);
    if (!regex) return;
    const ranges: Range[] = [];
    const walker = document.createTreeWalker(ref.current, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode())
      for (const match of (node.textContent ?? '').matchAll(regex)) {
        const range = new Range();
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        ranges.push(range);
      }
    const highlight = CSS.highlights.get('document-search-matches') ?? new Highlight();
    for (const range of ranges) highlight.add(range);
    CSS.highlights.set('document-search-matches', highlight);
    return () => {
      for (const range of ranges) highlight.delete(range);
      if (!highlight.size && CSS.highlights.get('document-search-matches') === highlight)
        CSS.highlights.delete('document-search-matches');
    };
  }, [text, query, supported]);
  if (supported)
    return (
      <p ref={ref} className="match-text related-excerpt">
        {text}
      </p>
    );
  const regex = pattern(query);
  const parts: React.ReactNode[] = [];
  let last = 0;
  if (regex)
    for (const match of text.matchAll(regex)) {
      parts.push(text.slice(last, match.index), <mark key={match.index}>{match[0]}</mark>);
      last = match.index + match[0].length;
    }
  parts.push(text.slice(last));
  return <p className="match-text related-excerpt">{parts}</p>;
}
