// Purpose: Verify explicit source confirmation and draft-preserving direction editing.
// Pattern: Real shadcn views with feature API mocks; backend tests cover persistence and scope.
// Usage: Vitest; real-server journeys cover upload and page previews.
// Related: studio-workspace.tsx, direction.tsx, backend/tests/studio_sources.rs.
import { renderRouted as render } from '@/test/render-routed';
import '@testing-library/jest-dom/vitest';
import { afterEach, it, expect, vi } from 'vitest';
import { screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterTestHarness } from '@/test/router';
import { StudioWorkspace } from './workspace';
import { Direction } from './direction';
import { StudioStepper } from './stepper';
import { getReview, confirmSources, getGuide, saveGuide } from './api';
import { ApiError } from '@/shared/api/http';
vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  getReview: vi.fn(),
  confirmSources: vi.fn(),
  getGuide: vi.fn(),
  saveGuide: vi.fn(),
}));
vi.mock('@/features/outlines', () => ({
  outlineKeys: { all: ['outlines'], state: (id: string) => ['outlines', id] },
  getOutline: async () => ({ confirmed: false }),
  OutlineWorkspace: () => null,
}));
vi.mock('@/features/projects', () => ({
  defaultFilters: {},
  getProject: async () => ({ id: 'p', name: '자료 준비', status: 'active' }),
  listProjects: async () => ({ items: [] }),
  listProjectOptions: async () => ({ items: [] }),
}));
vi.mock('@/features/space', async (original) => ({
  ...(await original<typeof import('@/features/space')>()),
  listAssets: async () => ({ items: [], total: 0 }),
  useUploadEngine: () => ({}),
}));
const clients: QueryClient[] = [];
async function mount(view: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  clients.push(client);
  await render(
    <RouterTestHarness>
      <QueryClientProvider client={client}>{view}</QueryClientProvider>
    </RouterTestHarness>,
  );
}
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((c) => {
    c.clear();
  });
  vi.clearAllMocks();
});
it('does not complete a source step by visiting it or allow empty confirmation', async () => {
  vi.mocked(getGuide).mockResolvedValue({ version: 0, do_text: '', dont_text: '' });
  vi.mocked(getReview).mockResolvedValue({
    snapshot: 'empty',
    ready: false,
    confirmed: false,
    count: 0,
  });
  await mount(<StudioWorkspace projectId="p" />);
  expect(await screen.findByText('첫 원본 문서를 추가하세요')).toBeVisible();
  expect(screen.queryByRole('button', { name: '원본 확인하고 계속' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '작성 방향' })).toBeDisabled();
  expect(confirmSources).not.toHaveBeenCalled();
});
it('pins the displayed snapshot on explicit confirmation and opens direction', async () => {
  vi.mocked(getReview).mockResolvedValue({
    snapshot: 'version-one',
    ready: true,
    confirmed: false,
    count: 1,
  });
  vi.mocked(confirmSources).mockResolvedValue({
    snapshot: 'version-one',
    ready: true,
    confirmed: true,
    count: 1,
  });
  vi.mocked(getGuide).mockResolvedValue({ version: 0, do_text: '', dont_text: '' });
  await mount(<StudioWorkspace projectId="p" />);
  await userEvent.click(await screen.findByRole('button', { name: '원본 확인하고 계속' }));
  await waitFor(() => expect(confirmSources).toHaveBeenCalledWith('p', 'version-one'));
  expect(await screen.findByRole('textbox', { name: 'Do · 이렇게 해주세요' })).toBeVisible();
  expect(saveGuide).not.toHaveBeenCalled();
});
it('preserves direction input after a shared revision conflict', async () => {
  vi.mocked(getGuide).mockResolvedValue({ version: 1, do_text: '기존 방향', dont_text: '' });
  vi.mocked(saveGuide).mockRejectedValue(
    new ApiError(409, 'revision_conflict', '다른 접속자가 수정했습니다.'),
  );
  await mount(<Direction project="p" editable />);
  const field = await screen.findByRole('textbox', { name: 'Do · 이렇게 해주세요' });
  await userEvent.clear(field);
  await userEvent.type(field, '새 강조사항');
  await userEvent.click(screen.getByRole('button', { name: '작성 방향 저장' }));
  await waitFor(() =>
    expect(saveGuide).toHaveBeenCalledWith('p', {
      version: 1,
      do_text: '새 강조사항',
      dont_text: '',
    }),
  );
  expect(field).toHaveValue('새 강조사항');
  expect(await screen.findByRole('button', { name: '최신 작성 방향 확인' })).toBeVisible();
});

it('blocks advancing past unsaved guidance and continues only after a successful save', async () => {
  vi.mocked(getReview).mockResolvedValue({
    snapshot: 'ready',
    ready: true,
    confirmed: true,
    count: 1,
  });
  vi.mocked(getGuide).mockResolvedValue({ version: 1, do_text: '기존 방향', dont_text: '' });
  vi.mocked(saveGuide).mockResolvedValue({ version: 2, do_text: '기존 방향 추가', dont_text: '' });
  await mount(<StudioWorkspace projectId="p" />);
  await userEvent.click(await screen.findByRole('button', { name: '작성 방향' }));
  await userEvent.type(
    await screen.findByRole('textbox', { name: 'Do · 이렇게 해주세요' }),
    ' 추가',
  );
  expect(screen.getByRole('button', { name: '목차·내용' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: '저장하고 목차로' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '목차·내용' })).toHaveAttribute(
      'aria-current',
      'step',
    ),
  );
  expect(saveGuide).toHaveBeenCalledWith('p', {
    version: 1,
    do_text: '기존 방향 추가',
    dont_text: '',
  });
});

it('exposes evidence as a real step without completing it and guards unsaved outlines', async () => {
  const select = vi.fn();
  const view = (dirty: boolean) => (
    <StudioStepper
      step="outline"
      source
      guide
      outline
      dirty={false}
      unsavedOutline={dirty}
      onSelect={select}
    />
  );
  const rendered = await render(view(true));
  expect(screen.getByRole('button', { name: '근거' })).toBeDisabled();
  rendered.rerender(view(false));
  await userEvent.click(screen.getByRole('button', { name: '근거' }));
  expect(select).toHaveBeenCalledWith('evidence');
  expect(screen.getByRole('button', { name: '근거' }).closest('li')).not.toHaveClass('is-done');
  expect(screen.getByRole('button', { name: '템플릿' })).toBeDisabled();
});
