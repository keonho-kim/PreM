// Purpose: Keep one global navigation and a shared Space-search entry across product routes.
// Pattern: Search/document routes belong to Space; no extra nav tree or modal command launcher.
// Usage: App renders this within BrowserRouter.
// Related: app.tsx, features/search/, app/styles/index.css.
import { Link, NavLink, useLocation } from 'react-router';
import { GlobalSearch } from '@/features/search';
export function AppHeader() {
  const { pathname } = useLocation();
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
          <NavLink to="/" end>
            Home
          </NavLink>
          <NavLink to="/studio">Studio</NavLink>
          <Link to="/space" aria-current={space ? 'page' : undefined}>
            Space
          </Link>
          <NavLink to="/admin">Admin</NavLink>
        </nav>
        <GlobalSearch />
      </div>
    </header>
  );
}
