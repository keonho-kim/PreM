// Purpose: Start Space-wide document search from the app header or dedicated results page.
// Pattern: Explicit form submission; typing remains local and IME composition never submits.
// Usage: Compact header entry and the large results-page input share one behavior.
// Related: search-page.tsx, api.ts, app/app.tsx.
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import './search.css';
export function SearchBox({
  initial = '',
  compact = false,
  onSearch,
}: {
  initial?: string;
  compact?: boolean;
  onSearch?: (query: string) => void;
}) {
  const [draft, setDraft] = useState(initial),
    navigate = useNavigate();
  const id = compact ? 'global-search' : 'library-search';
  return (
    <search className={compact ? 'global-search' : 'library-search'} aria-label="Space 통합 검색">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (onSearch) onSearch(draft.trim());
          else navigate(`/space?${new URLSearchParams({ q: draft.trim() })}`);
        }}
      >
        <Label className="search-label" htmlFor={id}>
          {compact ? '자료 검색' : 'Space 자료 검색'}
        </Label>
        <Input
          id={id}
          name="q"
          type="search"
          value={draft}
          maxLength={120}
          placeholder="자료 이름이나 본문에서 찾기"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.nativeEvent.isComposing) e.preventDefault();
          }}
        />
        <Button
          type="submit"
          variant={compact ? 'ghost' : 'default'}
          size={compact ? 'icon' : 'default'}
          aria-label="검색"
        >
          <Search aria-hidden="true" />
          {!compact && '검색'}
        </Button>
      </form>
    </search>
  );
}
export function GlobalSearch() {
  const location = useLocation();
  if (location.pathname === '/space' || location.pathname === '/search')
    return <span className="app-description">Space 자료 검색</span>;
  return <SearchBox key={location.pathname} compact />;
}
