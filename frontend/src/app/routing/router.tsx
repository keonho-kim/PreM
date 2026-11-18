// Purpose: Compose product routes with TanStack Router under the embedded /home base path.
// Pattern: Code-based route tree, lazy page boundaries, shared string query codec.
// Usage: App mounts the router inside the shared Query provider.
// Related: ../app.tsx, ../header.tsx, shared/routing/search.ts.
import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
  Link,
  Outlet,
  type RouterHistory,
} from '@tanstack/react-router';
import { parseSearch, stringifySearch, validateSearch } from '@/shared/routing/search';
import { loadSearchPage } from '@/features/search';
import { getModelSetup } from '@/shared/api/model-setup';
import { AppHeader } from '../header';
import { Feedback } from '../feedback';
import { PageLoadError, PagePending } from '../page-boundary';
function Shell() {
  return (
    <>
      <AppHeader />
      <Outlet />
      <Feedback />
    </>
  );
}
function NotFound() {
  return (
    <main className="container workspace">
      <title>페이지를 찾을 수 없습니다 | PreM</title>
      <h1>페이지를 찾을 수 없습니다</h1>
      <p>
        주소를 확인하거나 <Link to="/">홈으로 이동</Link>해 주세요.
      </p>
    </main>
  );
}
const root = createRootRoute({ component: Shell, notFoundComponent: NotFound, validateSearch });
const home = createRoute({
  getParentRoute: () => root,
  path: '/',
  beforeLoad: async ({ preload, abortController }) => {
    if (preload) return;
    const setup = await getModelSetup(abortController.signal);
    if (!setup.llm || !setup.decision) {
      throw redirect({
        to: '/admin',
        search: { setup: 'required', section: !setup.llm ? 'llm' : 'decision', tab: 'settings' },
        replace: true,
      });
    }
  },
  component: lazyRouteComponent(() => import('@/pages/projects-page'), 'ProjectsPage'),
});
const studio = createRoute({
  getParentRoute: () => root,
  path: 'studio',
  component: lazyRouteComponent(() => import('@/pages/studio-page'), 'StudioPage'),
});
const project = createRoute({
  getParentRoute: () => root,
  path: 'studio/$projectId',
  component: lazyRouteComponent(() => import('@/pages/studio-project-page'), 'StudioProjectPage'),
});
function librarySearch({ tab, q, ...rest }: Record<string, string>) {
  return { ...rest, scope: tab ?? rest.scope ?? 'all', ...(q ? { name: q } : {}) };
}
const space = createRoute({
  getParentRoute: () => root,
  path: 'space',
  beforeLoad: ({ search }) => {
    if ('tab' in search || (search.q && 'status' in search && !('scope' in search)))
      throw redirect({ to: '/space', search: librarySearch(search), replace: true });
  },
  component: lazyRouteComponent(loadSearchPage, 'SearchPage'),
});
const library = createRoute({
  getParentRoute: () => root,
  path: 'space/library',
  beforeLoad: ({ search, location }) => {
    throw redirect({
      to: '/space',
      search: librarySearch(search),
      hash: location.hash,
      replace: true,
    });
  },
});
const document = createRoute({
  getParentRoute: () => root,
  path: 'space/documents/$kind/$id',
  component: lazyRouteComponent(() => import('@/pages/document-page'), 'DocumentPage'),
});
const admin = createRoute({
  getParentRoute: () => root,
  path: 'admin',
  component: lazyRouteComponent(() => import('@/pages/admin-page'), 'AdminPage'),
});
const searchAlias = createRoute({
  getParentRoute: () => root,
  path: 'search',
  beforeLoad: ({ search, location }) => {
    throw redirect({ to: '/space', search, hash: location.hash, replace: true });
  },
});
const documentAlias = createRoute({
  getParentRoute: () => root,
  path: 'documents/$kind/$id',
  beforeLoad: ({ params, search, location }) => {
    throw redirect({
      to: '/space/documents/$kind/$id',
      params,
      search,
      hash: location.hash,
      replace: true,
    });
  },
});
const system = createRoute({
  getParentRoute: () => root,
  path: 'system',
  component: lazyRouteComponent(() => import('@/pages/home-page'), 'HomePage'),
});
const routeTree = root.addChildren([
  home,
  studio,
  project,
  space,
  library,
  document,
  admin,
  searchAlias,
  documentAlias,
  system,
]);
export const createAppRouter = (history?: RouterHistory) =>
  createRouter({
    history,
    routeTree,
    basepath: '/home',
    parseSearch,
    stringifySearch,
    defaultPreload: 'intent',
    defaultPendingComponent: PagePending,
    defaultErrorComponent: PageLoadError,
  });
export const router = createAppRouter();
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
