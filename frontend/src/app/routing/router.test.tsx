// Purpose: Verify deployed paths, old bookmarks and query history on the actual route tree.
// Pattern: Real TanStack memory history; mock page bodies to isolate navigation from API requests.
// Usage: Vitest; browser journeys separately verify page behavior against the real server.
// Related: router.tsx, shared/routing/search.ts, pages/space-redirect.tsx.
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, act } from '@testing-library/react';
import { createMemoryHistory, RouterProvider, useParams, useSearch } from '@tanstack/react-router';
import { renderRouted } from '@/test/render-routed';
import { createAppRouter } from './router';
vi.mock('../feedback', () => ({ Feedback: () => null }));
vi.mock('@/features/search', () => ({
  GlobalSearch: () => null,
  SearchPage: () => <p>Search body</p>,
}));
vi.mock('@/pages/projects-page', () => ({ ProjectsPage: () => <p>Home body</p> }));
vi.mock('@/pages/space-page', () => ({ SpacePage: () => <p>Library body</p> }));
vi.mock('@/pages/studio-page', () => ({
  StudioPage: () => <p>Studio {useParams({ strict: false }).projectId}</p>,
}));
vi.mock('@/pages/admin-page', () => ({
  AdminPage: () => <p>Admin {JSON.stringify(useSearch({ strict: false }))}</p>,
}));
vi.mock('@/pages/document-page', () => ({
  DocumentPage: () => <p>Document {JSON.stringify(useParams({ strict: false }))}</p>,
}));
afterEach(cleanup);
it('keeps query values as literal strings and preserves browser back/forward', async () => {
  const history = createMemoryHistory({ initialEntries: ['/home/?q=001'] });
  const router = createAppRouter(history);
  await renderRouted(<RouterProvider router={router} />);
  expect(await screen.findByText('Home body')).toBeVisible();
  await act(async () => {
    void router.navigate({
      to: '/admin',
      search: { section: 'decision', provider: '001', q: 'false' },
    });
  });
  expect(await screen.findByText(/Admin.*001/)).toBeVisible();
  expect(router.state.location.search).toMatchObject({ provider: '001', q: 'false' });
  expect(history.location.pathname).toBe('/home/admin');
  await act(async () => history.back());
  await waitFor(() => expect(router.state.location.search.q).toBe('001'));
  expect(await screen.findByText('Home body')).toBeVisible();
  await act(async () => history.forward());
  expect(await screen.findByText(/Admin.*001/)).toBeVisible();
});
it.each([
  ['/home/search?q=분기', '/home/space'],
  ['/home/space?tab=templates', '/home/space/library'],
  [
    '/home/documents/references/abc?job=job-001&page=page-001',
    '/home/space/documents/references/abc',
  ],
])('redirects bookmarked %s without dropping pinned query parameters', async (input, expected) => {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [input] }));
  await renderRouted(<RouterProvider router={router} />);
  await waitFor(() => expect(router.history.location.pathname).toBe(expected));
  for (const [key, value] of new URLSearchParams(input.split('?')[1]))
    expect(router.state.location.search[key]).toBe(value);
});
it('matches a project path and creates base-prefixed header links', async () => {
  const router = createAppRouter(
    createMemoryHistory({ initialEntries: ['/home/studio/project-123?step=outline'] }),
  );
  await renderRouted(<RouterProvider router={router} />);
  expect(await screen.findByText('Studio project-123')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/home/');
  expect(screen.getByRole('link', { name: 'Studio' })).toHaveAttribute('aria-current', 'page');
});
it('renders the product not-found page for unknown paths', async () => {
  const router = createAppRouter(createMemoryHistory({ initialEntries: ['/home/missing'] }));
  await renderRouted(<RouterProvider router={router} />);
  expect(await screen.findByRole('heading', { name: '페이지를 찾을 수 없습니다' })).toBeVisible();
});
