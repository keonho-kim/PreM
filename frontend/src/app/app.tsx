// Purpose: Compose shared, login-free product routes and the global shell.
// Pattern: Router and providers compose feature-owned pages.
// Usage: Rendered by main.tsx; no user or role filtering is applied.
// Related: pages/projects-page.tsx, features/projects/index.ts, AGENTS.md.
import { lazy, Suspense } from 'react';
import { BrowserRouter, Link, Route, Routes } from 'react-router';
import { Feedback } from './feedback';
import { AppHeader } from './header';
import { SpaceRedirect } from '@/pages/space-redirect';
import { HomePage } from '@/pages/home-page';
const ProjectsPage = lazy(() =>
  import('@/pages/projects-page').then((module) => ({ default: module.ProjectsPage })),
);
const SpacePage = lazy(() =>
  import('@/pages/space-page').then((module) => ({ default: module.SpacePage })),
);
const StudioPage = lazy(() =>
  import('@/pages/studio-page').then((m) => ({ default: m.StudioPage })),
);
const SearchPage = lazy(() =>
  import('@/pages/search-page').then((m) => ({ default: m.SearchPage })),
);
const DocumentPage = lazy(() =>
  import('@/pages/document-page').then((m) => ({ default: m.DocumentPage })),
);
const AdminPage = lazy(() => import('@/pages/admin-page').then((m) => ({ default: m.AdminPage })));
import { Providers } from './providers';
import { PageBoundary } from './page-boundary';

export function App() {
  return (
    <Providers>
      <BrowserRouter basename="/home">
        <AppHeader />
        <Routes>
          <Route path="search" element={<SpaceRedirect />} />
          <Route path="documents/:kind/:id" element={<SpaceRedirect />} />
          <Route
            path="space"
            element={
              <PageBoundary key="search">
                <Suspense
                  fallback={
                    <main className="container workspace">
                      <p role="status">검색 화면을 불러옵니다.</p>
                    </main>
                  }
                >
                  <SearchPage />
                </Suspense>
              </PageBoundary>
            }
          />
          <Route
            path="space/documents/:kind/:id"
            element={
              <PageBoundary key="document">
                <Suspense
                  fallback={
                    <main className="container workspace">
                      <p role="status">자료를 불러옵니다.</p>
                    </main>
                  }
                >
                  <DocumentPage />
                </Suspense>
              </PageBoundary>
            }
          />

          <Route
            index
            element={
              <PageBoundary>
                <Suspense
                  fallback={
                    <main className="container workspace">
                      <h1>프로젝트</h1>
                      <p role="status">화면을 불러오고 있습니다.</p>
                    </main>
                  }
                >
                  <ProjectsPage />
                </Suspense>
              </PageBoundary>
            }
          />
          <Route
            path="space/library"
            element={
              <PageBoundary key="space">
                <Suspense
                  fallback={
                    <main className="container workspace">
                      <h1>Space</h1>
                      <p role="status">화면을 불러오고 있습니다.</p>
                    </main>
                  }
                >
                  <SpacePage />
                </Suspense>
              </PageBoundary>
            }
          />
          <Route
            path="admin"
            element={
              <PageBoundary key="admin">
                <Suspense
                  fallback={
                    <main className="container workspace">
                      <h1>Admin</h1>
                      <p role="status">화면을 불러오고 있습니다.</p>
                    </main>
                  }
                >
                  <AdminPage />
                </Suspense>
              </PageBoundary>
            }
          />
          <Route
            path="studio/:projectId?"
            element={
              <PageBoundary key="studio">
                <Suspense
                  fallback={
                    <main className="container workspace">
                      <p role="status">Studio를 불러옵니다.</p>
                    </main>
                  }
                >
                  <StudioPage />
                </Suspense>
              </PageBoundary>
            }
          />
          <Route path="system" element={<HomePage />} />
          <Route
            path="*"
            element={
              <main className="container workspace">
                <title>페이지를 찾을 수 없습니다 | PuPuTyX</title>
                <h1>페이지를 찾을 수 없습니다</h1>
                <p>
                  주소를 확인하거나 <Link to="/">홈으로 이동</Link>해 주세요.
                </p>
              </main>
            }
          />
        </Routes>
        <Feedback />
      </BrowserRouter>
    </Providers>
  );
}
