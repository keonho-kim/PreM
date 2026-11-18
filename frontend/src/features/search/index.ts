// Purpose: Expose the shared Space search entry and route view.
// Pattern: Feature facade; request shapes and result rows remain private.
// Usage: App shell and the search route.
// Related: search-box.tsx, search-page.tsx.
export { GlobalSearch } from './search-box';
export const loadSearchPage = () => import('./search-page');
