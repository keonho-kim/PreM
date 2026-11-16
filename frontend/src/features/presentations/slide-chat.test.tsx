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
import { getEdits, sendEdit, editCommand, type Edit } from './edit-api';
import type { Run, Slide } from './api';
import { useChatDrafts } from './chat-drafts';
vi.mock('./edit-api', async (original) => ({
  ...(await original<typeof import('./edit-api')>()),
  getEdits: vi.fn(),
  sendEdit: vi.fn(),
  editCommand: vi.fn(),
}));
vi.mock('@/features/providers', () => ({
  authoringModelsKey: ['authoring-models'],
  listAuthoringModels: async () => [
    { id: 'model', name: 'Ornith', version: 1, model_identifier: 'ornith' },
  ],
}));
vi.mock('@/components/ui/message-scroller', () => ({
  MessageScrollerProvider: ({ children }: { children: React.ReactNode }) => children,
  MessageScroller: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MessageScrollerViewport: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MessageScrollerContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MessageScrollerItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MessageScrollerButton: () => null,
}));
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
  before: originalSpec,
  proposal: { ...originalSpec, title: '새 제목' },
};
let client: QueryClient;
function mount() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <SlideChat project="p" run={run} slide={slide} active canEdit onResult={() => {}} />
    </QueryClientProvider>,
  );
}
afterEach(() => {
  cleanup();
  client.clear();
  vi.clearAllMocks();
  useChatDrafts.setState({ drafts: {} });
});
it('does not send IME confirmation keys and pins the selected field/model to one request', async () => {
  vi.mocked(getEdits).mockResolvedValue([]);
  vi.mocked(sendEdit).mockResolvedValue({ ...edit, status: 'queued' });
  useChatDrafts
    .getState()
    .update('p:run:slide', { model: 'model', scope: 'title', prompt: '제목을 수정해줘' });
  mount();
  const input = screen.getByRole('textbox', { name: '슬라이드 수정 요청' });
  await waitFor(() => expect(screen.getByText('Ornith')).toBeInTheDocument());
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
  fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
  fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
  expect(sendEdit).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: '수정 요청 보내기' }));
  await waitFor(() => expect(sendEdit).toHaveBeenCalledTimes(1));
  expect(vi.mocked(sendEdit).mock.calls[0]?.[4]).toEqual({
    expected_version: 1,
    connection_id: 'model',
    model_version: 1,
    prompt: '제목을 수정해줘',
    fields: ['title'],
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
  await screen.findByText('새 제목');
  expect(screen.getByText('기존 제목')).toBeVisible();
  expect(editCommand).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: '수정안 적용' }));
  await waitFor(() => expect(editCommand).toHaveBeenCalledTimes(1));
  expect(vi.mocked(editCommand).mock.calls[0]?.[2]).toBe('apply');
});
it('retains drafts independently for different immutable slide scopes', () => {
  const update = useChatDrafts.getState().update;
  update('p:run:slide', { prompt: '첫 슬라이드 요청', scope: 'title' });
  update('p:run:other', { prompt: '다른 슬라이드 요청' });
  expect(useChatDrafts.getState().drafts['p:run:slide']?.prompt).toBe('첫 슬라이드 요청');
  client = new QueryClient();
});
