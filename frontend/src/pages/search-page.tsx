// Purpose: Make Space's home the shared search workspace and preserve old library bookmarks.
// Pattern: Route-level compatibility; search and library features retain separate data ownership.
// Usage: Lazy /home/space route; /home/search redirects here.
// Related: features/search/index.ts, space-page.tsx, app/app.tsx.
import { Navigate, useLocation } from 'react-router';
import { SearchPage as LibrarySearch } from '@/features/search';
export function SearchPage() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  if (params.has('tab') || params.has('status'))
    return <Navigate replace to={`/space/library${location.search}`} />;
  return <LibrarySearch />;
}
