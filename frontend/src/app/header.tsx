// Purpose: Keep one global navigation and a shared Space-search entry across product routes.
// Pattern: Search/document routes belong to Space; no extra nav tree or modal command launcher.
// Usage: App renders this within TanStack Router.
// Related: app.tsx, features/search/, app/styles/index.css.
import { Link } from '@tanstack/react-router';
import { useAppPath } from '@/shared/routing/path';
import { GlobalSearch } from '@/features/search';
export function AppHeader() {
  const pathname = useAppPath();
  const space =
    pathname === '/space' ||
    pathname.startsWith('/space/') ||
    pathname === '/search' ||
    pathname.startsWith('/documents/');
  return (
    <header className="app-header">
      <div className="container">
        <Link className="brand" to="/">
          PreM
        </Link>
        <nav className="app-navigation" aria-label="주요 메뉴">
          <Link
            to="/"
            activeOptions={{ exact: true, includeSearch: false }}
            activeProps={{ className: 'active' }}
          >
            Home
          </Link>
          <Link
            to="/studio"
            activeOptions={{ includeSearch: false }}
            activeProps={{ className: 'active' }}
          >
            Studio
          </Link>
          <Link to="/space" aria-current={space ? 'page' : undefined}>
            Space
          </Link>
          <Link
            to="/admin"
            activeOptions={{ includeSearch: false }}
            activeProps={{ className: 'active' }}
          >
            Admin
          </Link>
        </nav>
        <GlobalSearch />
      </div>
    </header>
  );
}
