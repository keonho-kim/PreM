// Purpose: Preserve bookmarked search and document URLs while Space becomes the search home.
// Pattern: Replace-only internal route aliases retain query filters and pinned document identities.
// Usage: App's retired /search and /documents paths.
// Related: search-page.tsx, document-page.tsx, app/app.tsx.
import { Navigate, useLocation } from 'react-router';
export function SpaceRedirect() {
  const location = useLocation();
  const path = location.pathname === '/search' ? '/space' : `/space${location.pathname}`;
  return <Navigate replace to={`${path}${location.search}${location.hash}`} />;
}
