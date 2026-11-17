// Purpose: Verify outline draft conflicts, explicit confirmation and shared-source multi-mapping.
// Pattern: Real shadcn controls with mocked canonical transport and stable input identities.
// Usage: Vitest; browser tests cover persisted source/model workflows and reorder focus.
// Related: editor.tsx, mapping.tsx, draft.ts, backend/tests/outlines.rs.
import { renderRouted as render } from '@/test/render-routed';
import '@testing-library/jest-dom/vitest';
import { it, expect, vi, afterEach } from 'vitest';
import { screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterTestHarness } from '@/test/router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OutlineEditor } from './editor';
import { ContentMapping } from './mapping';
import { move } from './draft';
import { confirmOutline, getBlocks, type OutlineState } from './api';
vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  getBlocks: vi.fn(),
  confirmOutline: vi.fn(),
  saveOutline: vi.fn(),
}));
vi.mock('@/features/providers', () => ({
  authoringModelsKey: ['authoring-models'],
  listAuthoringModels: async () => [],
  getProviderCatalog: async () => [],
}));
const node = 'f12fb1d0-ff11-4809-81c8-26a03ef9ed35',
  other = '7e2da9dc-bb72-47d4-bfc6-dd2f84c4473e',
  block = '482c0549-164d-4411-877f-1b4d99c9532b';
const state: OutlineState = {
  version: 1,
  revision_id: node,
  source_snapshot: 'snapshot',
  guide_version: 1,
  stale: false,
  confirmed: false,
  ready: true,
  run: null,
  draft: {
    nodes: [{ id: node, parent_id: null, title: '원래 제목', description: '' }],
    assignments: [{ node_id: node, block_id: block }],
  },
};
const clients: QueryClient[] = [];
function wrap(view: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  clients.push(client);
  return (
    <RouterTestHarness>
      <QueryClientProvider client={client}>{view}</QueryClientProvider>
    </RouterTestHarness>
  );
}
afterEach(() => {
  cleanup();
  for (const c of clients.splice(0)) c.clear();
  vi.clearAllMocks();
});
it('retains local text when another user saves a newer revision', async () => {
  vi.mocked(getBlocks).mockResolvedValue({ items: [], total: 0, offset: 0 });
  const c = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(c);
  const view = (server: OutlineState) => (
    <RouterTestHarness>
      <QueryClientProvider client={c}>
        <OutlineEditor project={node} server={server} editable historical={false} />
      </QueryClientProvider>
    </RouterTestHarness>
  );
  const rendered = await render(view(state));
  expect(screen.queryByRole('textbox', { name: '1번 목차 제목' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '목차 편집' }));
  const input = screen.getByRole('textbox', { name: '1번 목차 제목' });
  await userEvent.clear(input);
  await userEvent.type(input, '내 수정');
  rendered.rerender(
    view({
      ...state,
      version: 2,
      draft: {
        ...state.draft,
        nodes: [{ id: node, parent_id: null, description: '', title: '다른 사람 수정' }],
      },
    }),
  );
  expect(input).toHaveValue('내 수정');
  await userEvent.click(screen.getByRole('button', { name: '편집 마치기' }));
  expect(screen.getByRole('button', { name: '목차·연결 저장' })).toBeDisabled();
  expect(screen.getByText(/내 입력은 그대로/)).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: '저장된 목차 불러오기' }));
  await userEvent.click(screen.getByRole('button', { name: '목차 편집' }));
  expect(screen.getByRole('textbox', { name: '1번 목차 제목' })).toHaveValue('다른 사람 수정');
});
it('only confirms a saved revision after the explicit confirmation command', async () => {
  vi.mocked(getBlocks).mockResolvedValue({ items: [], total: 0, offset: 0 });
  vi.mocked(confirmOutline).mockResolvedValue({ ...state, confirmed: true });
  await render(wrap(<OutlineEditor project={node} server={state} editable historical={false} />));
  expect(confirmOutline).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: '목차·내용 확정' }));
  await waitFor(() => expect(confirmOutline).toHaveBeenCalledWith(node, 1));
});
it('can assign one canonical block to another section without copying its text', async () => {
  vi.mocked(getBlocks).mockResolvedValue({
    items: [
      {
        id: block,
        source_version_id: node,
        item_id: node,
        file_version: 1,
        filename: '원본.md',
        page_id: block,
        page_label: '본문',
        job_id: node,
        kind: 'paragraph',
        text: '공유 근거',
        preview: null,
      },
    ],
    total: 1,
    offset: 0,
  });
  const change = vi.fn();
  await render(
    wrap(
      <ContentMapping
        project={node}
        draft={{
          ...state.draft,
          nodes: [
            ...state.draft.nodes,
            { id: other, parent_id: null, title: '두 번째', description: '' },
          ],
        }}
        nodeId={other}
        disabled={false}
        onChange={change}
      />,
    ),
  );
  expect(getBlocks).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: '내용 담기' }));
  await userEvent.click(await screen.findByRole('button', { name: '이 목차에 연결' }));
  expect(change.mock.calls[0]?.[0].assignments).toEqual(
    expect.arrayContaining([
      { node_id: node, block_id: block },
      { node_id: other, block_id: block },
    ]),
  );
});
it('moves a root and its children together while preserving stable IDs', async () => {
  const child = { id: block, parent_id: node, title: '하위', description: '' };
  const second = { id: other, parent_id: null, title: '다음', description: '' };
  const draft = {
    nodes: [{ id: node, parent_id: null, title: '원래 제목', description: '' }, child, second],
    assignments: state.draft.assignments,
  };
  expect(move(draft, node, 1).nodes.map((n) => n.id)).toEqual([other, node, block]);
  expect(move(draft, node, 1).assignments).toBe(draft.assignments);
});
