// Purpose: Verify explicit search admission, uncertain-request retries and safe match rendering.
// Pattern: Real feature controls with mocked transport; server tests own model execution semantics.
// Usage: Vitest; browser journeys cover native highlights, source links and layout.
// Related: related-documents.tsx, shared/ui/match-text.tsx, api.ts.
import { renderRouted as render } from '@/test/render-routed';
import '@testing-library/jest-dom/vitest';
import { afterEach, it, expect, vi } from 'vitest';
import { screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterTestHarness } from '@/test/router';
import { RelatedDocuments } from './related-documents';
import { MatchText } from '@/shared/ui/match-text';
import { search, getRun, getResults, type SearchRun } from './api';
vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  search: vi.fn(),
  getRun: vi.fn(),
  getResults: vi.fn(),
  getSelected: async () => ({ items: [], total: 0, offset: 0 }),
}));
vi.mock('@/features/projects', () => ({ listProjectOptions: async () => ({ items: [] }) }));
const clients: QueryClient[] = [];
async function mount(view: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  clients.push(client);
  return await render(
    <RouterTestHarness>
      <QueryClientProvider client={client}>{view}</QueryClientProvider>
    </RouterTestHarness>,
  );
}
afterEach(() => {
  cleanup();
  for (const c of clients.splice(0)) c.clear();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
const run: SearchRun = {
  id: 'c722f51f-5023-4c14-a6aa-c39d71209f81',
  project_id: 'f12fb1d0-ff11-4809-81c8-26a03ef9ed35',
  query: 'efficiency',
  options: {
    include_archived: true,
    previous_versions: false,
    source_project: null,
    format: null,
    since: null,
  },
  status: 'succeeded',
  version: 3,
  total: 0,
  completed: 0,
  cache_hits: 0,
  stale: false,
  error_code: null,
  created_at: 1,
};
it('does not search on typing and retries the exact uncertain request identity', async () => {
  vi.mocked(getRun).mockImplementation(async (_p, id) => (id ? run : null));
  vi.mocked(getResults).mockResolvedValue({ items: [], total: 0, offset: 0 });
  vi.mocked(search).mockRejectedValueOnce(new Error('전송 실패')).mockResolvedValue(run);
  await mount(<RelatedDocuments project={run.project_id} ready editable />);
  await userEvent.click(screen.getByRole('tab', { name: '추가 검색' }));
  await userEvent.type(screen.getByRole('textbox', { name: /추가로 찾을 주제/ }), 'efficiency');
  expect(search).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: '관련 자료 찾기' }));
  await screen.findByText(/서버에 연결하지/);
  await userEvent.click(screen.getByRole('button', { name: '관련 자료 찾기' }));
  await waitFor(() => expect(search).toHaveBeenCalledTimes(2));
  expect(vi.mocked(search).mock.calls[1]).toEqual(vi.mocked(search).mock.calls[0]);
});
it('renders only literal matches in the safe fallback, never source HTML', async () => {
  vi.stubGlobal('Highlight', undefined);
  const { container } = await render(
    <MatchText text={'<img src=x onerror=alert(1)> efficiency EFFICIENCY'} query="efficiency" />,
  );
  expect(container.querySelector('img')).toBeNull();
  expect(container.querySelectorAll('mark')).toHaveLength(2);
  expect(container).toHaveTextContent('<img src=x onerror=alert(1)>');
});
it('cleans up only owned native ranges when results change or leave the page', async () => {
  const registry = new Map<string, Set<Range>>();
  registry.set('other-feature', new Set());
  vi.stubGlobal('CSS', { highlights: registry });
  vi.stubGlobal('Highlight', class extends Set<Range> {});
  const { rerender, unmount } = await render(
    <>
      <MatchText text="efficiency one" query="efficiency" />
      <MatchText text="efficiency two" query="efficiency" />
    </>,
  );
  expect(registry.get('document-search-matches')?.size).toBe(2);
  rerender(
    <>
      <MatchText text="different" query="efficiency" />
      <MatchText text="efficiency two" query="efficiency" />
    </>,
  );
  expect(registry.get('document-search-matches')?.size).toBe(1);
  unmount();
  expect(registry.has('document-search-matches')).toBe(false);
  expect(registry.has('other-feature')).toBe(true);
});

it('shows adaptive phase and partial coverage without a misleading overall percentage', async () => {
  vi.mocked(getRun).mockResolvedValue({
    ...run,
    status: 'running',
    total: 8,
    completed: 6,
    exploration: {
      phase: 'discover',
      round: 1,
      read_blocks: 12,
      added_candidates: 0,
      unresolved: 2,
      stop_reason: null,
    },
  });
  vi.mocked(getResults).mockResolvedValue({ items: [], total: 0, offset: 0 });
  await mount(<RelatedDocuments project={run.project_id} ready editable />);
  await userEvent.click(screen.getByRole('tab', { name: '추가 검색' }));
  await waitFor(() => {
    expect(screen.getByText('부족한 근거를 보완할 자료를 더 찾고 있습니다.')).toBeVisible();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getByText(/직접 확인이 필요한 후보 2개/)).toBeVisible();
  });
});

it('opens selected evidence first and keeps the query draft when switching work tabs', async () => {
  vi.mocked(getRun).mockResolvedValue(null);
  vi.mocked(getResults).mockResolvedValue({ items: [], total: 0, offset: 0 });
  await mount(<RelatedDocuments project={run.project_id} ready editable />);
  expect(screen.getByRole('tab', { name: '선택한 근거' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.queryByRole('textbox', { name: /추가로 찾을 주제/ })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('tab', { name: '추가 검색' }));
  await userEvent.type(screen.getByRole('textbox', { name: /추가로 찾을 주제/ }), '비용 비교');
  await userEvent.click(screen.getByRole('tab', { name: '선택한 근거' }));
  await userEvent.click(screen.getByRole('tab', { name: '추가 검색' }));
  expect(screen.getByRole('textbox', { name: /추가로 찾을 주제/ })).toHaveValue('비용 비교');
  expect(search).not.toHaveBeenCalled();
});
