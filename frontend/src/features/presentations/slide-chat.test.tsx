// Purpose: Verify IME-safe scoped requests, draft isolation and explicit proposal acceptance.
// Pattern: Real composer with a transport fixture; viewport scrolling is covered in the browser.
// Usage: Vitest; uses local synthetic messages only.
// Related: slide-chat.tsx, edit-proposal.tsx, backend/tests/slide_edits.rs.
import '@testing-library/jest-dom/vitest';
import { it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SlideChat } from './slide-chat';
import { EditProposal } from './edit-proposal';
import { getEdits, sendEdit, editCommand, type Edit } from './edit-api';
import type { Run, Slide } from './api';
import { useEditThread } from './use-edit-thread';
import { Provider } from 'react-redux';
import { createTestStore } from '@/test/state';
import { draftUpdated, resetDrafts, chatDraftSelectors } from './chat-state';
vi.mock('./edit-api', async (original) => ({
  ...(await original<typeof import('./edit-api')>()),
  getEdits: vi.fn(),
  sendEdit: vi.fn(),
  editCommand: vi.fn(),
}));
vi.mock('@/components/ui/message-scroller', () => ({
  MessageScrollerProvider: ({ children }: { children: React.ReactNode }) => children,
  MessageScroller: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MessageScrollerViewport: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MessageScrollerContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MessageScrollerItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MessageScrollerButton: () => null,
}));
const store = createTestStore();
const run: Run = {
  id: 'run',
  project_id: 'p',
  presentation_id: 'deck',
  presentation_version: 1,
  is_current: true,
  title: '발표',
  status: 'succeeded',
  stage: 'complete',
  version: 3,
  completed: 1,
  total: 1,
  error_code: null,
  created_at: 0,
};
const originalSpec: NonNullable<Slide['spec']> = {
  schema_version: 1,
  title: '기존 제목',
  bullets: ['본문 유지'],
  notes: '메모 유지',
  block_ids: [],
};
const slide: Slide = {
  id: 'slide',
  position: 1,
  preview: true,
  spec: originalSpec,
};
const edit: Edit = {
  id: 'edit',
  project_id: 'p',
  presentation_id: 'deck',
  base_revision_id: 'run',
  base_version: 1,
  source_slide_id: 'slide',
  connection_id: 'model',
  prompt: '제목을 수정해줘',
  fields: ['title'],
  status: 'ready',
  version: 3,
  message: '제목을 짧게 바꿨습니다.',
  error_code: null,
  applied_run_id: null,
  render_status: null,
  created_at: 1,
  preview: true,
  before: originalSpec,
  proposal: { ...originalSpec, title: '새 제목' },
};
let client: QueryClient;
function TestChat(props: Partial<React.ComponentProps<typeof SlideChat>>) {
  const history = useEditThread('p', run, slide, true);
  return (
    <SlideChat
      project="p"
      run={run}
      slide={slide}
      canEdit
      history={history}
      onResult={() => {}}
      {...props}
      session={props.session === undefined ? 'session' : props.session}
    />
  );
}
function mount(props: Partial<React.ComponentProps<typeof SlideChat>> = {}) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <Provider store={store}>
      <QueryClientProvider client={client}>
        <TestChat {...props} />
      </QueryClientProvider>
    </Provider>,
  );
}
afterEach(() => {
  cleanup();
  client.clear();
  vi.clearAllMocks();
  store.dispatch(resetDrafts());
});
it('does not send IME confirmation keys and defaults to the entire current slide without model controls', async () => {
  vi.mocked(getEdits).mockResolvedValue([]);
  vi.mocked(sendEdit).mockResolvedValue({ ...edit, status: 'queued' });
  store.dispatch(draftUpdated({ key: 'p:run:slide', change: { prompt: '제목을 수정해줘' } }));
  mount();
  const input = screen.getByRole('textbox', { name: '슬라이드 수정 요청' });
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
  fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
  fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
  expect(sendEdit).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: '수정 요청 보내기' }));
  await waitFor(() => expect(sendEdit).toHaveBeenCalledTimes(1));
  expect(vi.mocked(sendEdit).mock.calls[0]?.[4]).toEqual({
    expected_version: 1,
    prompt: '제목을 수정해줘',
    fields: ['title', 'bullets', 'notes', 'objects', 'layout'],
  });
});
it('does not apply the returned proposal until the user accepts its visible difference', async () => {
  vi.mocked(getEdits).mockResolvedValue([edit]);
  vi.mocked(editCommand).mockResolvedValue({
    ...edit,
    status: 'applying',
    applied_run_id: 'new-run',
  });
  mount();
  await screen.findByText(/가운데 장표에서 수정안을 확인하세요/);
  expect(screen.queryByRole('button', { name: '수정 전후 보기' })).not.toBeInTheDocument();
  expect(editCommand).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: '수정안 적용' }));
  await waitFor(() => expect(editCommand).toHaveBeenCalledTimes(1));
  expect(vi.mocked(editCommand).mock.calls[0]?.[2]).toBe('apply');
});
it('retains drafts independently for different immutable slide scopes', () => {
  const update = (key: string, change: { prompt: string }) =>
    store.dispatch(draftUpdated({ key, change }));
  update('p:run:slide', { prompt: '첫 슬라이드 요청' });
  update('p:run:other', { prompt: '다른 슬라이드 요청' });
  expect(chatDraftSelectors.selectById(store.getState(), 'p:run:slide')?.prompt).toBe(
    '첫 슬라이드 요청',
  );
  client = new QueryClient();
});

it('pins a multi-slide visual request while preserving the selected text fields', async () => {
  vi.mocked(getEdits).mockResolvedValue([]);
  vi.mocked(sendEdit).mockResolvedValue({ ...edit, status: 'queued' });
  store.dispatch(
    draftUpdated({
      key: 'p:run:slide',
      change: {
        prompt: '두 장표에 차트를 추가해줘',
      },
    }),
  );
  mount({ targetSlides: [slide, { ...slide, id: 'second', position: 2 }] });
  await userEvent.click(screen.getByRole('button', { name: '수정 요청 보내기' }));
  await waitFor(() => expect(sendEdit).toHaveBeenCalledTimes(1));
  expect(vi.mocked(sendEdit).mock.calls[0]?.[4]).toMatchObject({
    fields: ['title', 'bullets', 'notes', 'objects', 'layout'],
    slide_ids: ['slide', 'second'],
  });
});
it('limits a component-selected request to explicit object IDs', async () => {
  vi.mocked(getEdits).mockResolvedValue([]);
  vi.mocked(sendEdit).mockResolvedValue({ ...edit, status: 'queued' });
  store.dispatch(draftUpdated({ key: 'p:run:slide', change: { prompt: '오른쪽으로 옮겨줘' } }));
  mount({ objectIds: ['chart-1', 'image-1'] });
  await userEvent.click(screen.getByRole('button', { name: '수정 요청 보내기' }));
  await waitFor(() => expect(sendEdit).toHaveBeenCalledTimes(1));
  expect(vi.mocked(sendEdit).mock.calls[0]?.[4]).toMatchObject({
    fields: ['objects'],
    object_ids: ['chart-1', 'image-1'],
  });
});

it('keeps comparison and result navigation out of chat when a proposal becomes ready', () => {
  client = new QueryClient();
  const view = (status: Edit['status']) => (
    <EditProposal edit={{ ...edit, status }} current pending={false} onCommand={() => {}} />
  );
  const { rerender } = render(view('running'));
  expect(screen.queryByRole('button', { name: '수정안 적용' })).not.toBeInTheDocument();
  rerender(view('ready'));
  expect(screen.getByRole('button', { name: '수정안 적용' })).toBeVisible();
  expect(screen.queryByRole('button', { name: '수정 전후 보기' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '수정 결과 보기' })).not.toBeInTheDocument();
});
