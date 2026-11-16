// Purpose: Verify explicit unified-search submission, inert snippets and full-page result navigation.
// Pattern: Real Router/Query behavior with mocked read transport; server tests enforce Space scope.
// Usage: Vitest; browser tests own layout and native navigation.
// Related: search-page.tsx, search-box.tsx, api.ts.
import '@testing-library/jest-dom/vitest';
import { afterEach, it, expect, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SearchPage } from './search-page';
import { findDocuments } from './api';
vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  findDocuments: vi.fn(),
}));
const clients: QueryClient[] = [];
function Location() {
  return <output data-testid="location">{useLocation().pathname + useLocation().search}</output>;
}
function mount(route = '/space') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  return render(
    <MemoryRouter initialEntries={[route]}>
      <QueryClientProvider client={client}>
        <SearchPage />
        <Location />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  vi.clearAllMocks();
});
it('waits for explicit submission and searches the shared Space scope', async () => {
  vi.mocked(findDocuments).mockResolvedValue({ items: [], total: 0, offset: 0, limit: 12 });
  mount();
  const input = screen.getByRole('searchbox', { name: 'Space 자료 검색' });
  await userEvent.type(input, '분기 보고');
  expect(findDocuments).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
  expect(findDocuments).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: '검색' }));
  await waitFor(() => expect(findDocuments).toHaveBeenCalledOnce());
  expect(vi.mocked(findDocuments).mock.calls[0]?.[0]).toMatchObject({
    q: '분기 보고',
    scope: 'all',
    offset: 0,
  });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByTestId('location')).toHaveTextContent('/space?q=');
});
it('shows safe excerpt text and links to the exact job/page on a document route', async () => {
  vi.mocked(findDocuments).mockResolvedValue({
    items: [
      {
        id: '7e2da9dc-bb72-47d4-bfc6-dd2f84c4473e',
        kind: 'references',
        title: '운영 보고',
        filename: '보고.md',
        format: 'md',
        file_version: 2,
        updated_at: 1,
        job_id: '25ff0cd9-2171-4cd6-bddb-a38530657665',
        page_id: '482c0549-164d-4411-877f-1b4d99c9532b',
        page_label: 'Markdown 본문',
        preview: null,
        excerpt: '<img src=x onerror=alert(1)> 분기 실적',
        name_match: false,
        content_match: true,
      },
    ],
    total: 1,
    offset: 0,
    limit: 12,
  });
  const { container } = mount('/space?q=분기');
  const link = await screen.findByRole('link', { name: '운영 보고' });
  expect(link.getAttribute('href')).toContain('/documents/references/');
  expect(link.getAttribute('href')).toContain('job=25ff0cd9');
  expect(link.getAttribute('href')).toContain('page=482c0549');
  expect(container.querySelector('img')).toBeNull();
  expect(screen.getByText(/<img src=x/)).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
