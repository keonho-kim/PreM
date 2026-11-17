// Purpose: Compose product routes with TanStack Router under the embedded /home base path.
// Pattern: Code-based route tree, lazy page boundaries, shared string query codec.
// Usage: App mounts the router inside the shared Query provider.
// Related: ../app.tsx, ../header.tsx, shared/routing/search.ts.
import { lazy, Suspense, type ComponentType } from 'react';
import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  Link,
  Outlet,
  type RouterHistory,
} from '@tanstack/react-router';
import { parseSearch, stringifySearch, validateSearch } from '@/shared/routing/search';
import { AppHeader } from '../header';
import { Feedback } from '../feedback';
import { PageBoundary } from '../page-boundary';
import { HomePage } from '@/pages/home-page';
const ProjectsPage = lazy(() =>
  import('@/pages/projects-page').then((m) => ({ default: m.ProjectsPage })),
);
const SpacePage = lazy(() => import('@/pages/space-page').then((m) => ({ default: m.SpacePage })));
const SearchPage = lazy(() => import('@/features/search').then((m) => ({ default: m.SearchPage })));
const StudioPage = lazy(() =>
  import('@/pages/studio-page').then((m) => ({ default: m.StudioPage })),
);
const DocumentPage = lazy(() =>
  import('@/pages/document-page').then((m) => ({ default: m.DocumentPage })),
);
const AdminPage = lazy(() => import('@/pages/admin-page').then((m) => ({ default: m.AdminPage })));
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
function page(Component: ComponentType, name: string) {
  return function Page() {
    return (
      <PageBoundary>
        <Suspense
          fallback={
            <main className="container workspace">
              <p role="status">{name} 화면을 불러옵니다.</p>
            </main>
          }
        >
          <Component />
        </Suspense>
      </PageBoundary>
    );
  };
}
const root = createRootRoute({ component: Shell, notFoundComponent: NotFound, validateSearch });
const home = createRoute({
  getParentRoute: () => root,
  path: '/',
  component: page(ProjectsPage, '프로젝트'),
});
const studio = createRoute({
  getParentRoute: () => root,
  path: 'studio',
  component: page(StudioPage, 'Studio'),
});
const project = createRoute({
  getParentRoute: () => root,
  path: 'studio/$projectId',
  component: page(StudioPage, 'Studio'),
});
const space = createRoute({
  getParentRoute: () => root,
  path: 'space',
  beforeLoad: ({ search }) => {
    if ('tab' in search || 'status' in search)
      throw redirect({ to: '/space/library', search, replace: true });
  },
  component: page(SearchPage, '검색'),
});
const library = createRoute({
  getParentRoute: () => root,
  path: 'space/library',
  component: page(SpacePage, 'Space'),
});
const document = createRoute({
  getParentRoute: () => root,
  path: 'space/documents/$kind/$id',
  component: page(DocumentPage, '자료'),
});
const admin = createRoute({
  getParentRoute: () => root,
  path: 'admin',
  component: page(AdminPage, 'Admin'),
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
const system = createRoute({ getParentRoute: () => root, path: 'system', component: HomePage });
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
    defaultPreload: false,
  });
export const router = createAppRouter();
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
