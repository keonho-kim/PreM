// Purpose: Verify selected section requests, explicit empty-scope feedback and revision-scoped drafts.
// Pattern: Real form/checkbox/select primitives with mocked feature I/O boundaries.
// Usage: Vitest; presentation-scope.cjs covers actual server and native files.
// Related: generation-form.tsx, generation-scope.tsx, api.ts.
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeAll, afterAll, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GenerationForm } from './generation-form';
import { ApiError } from '@/shared/api/http';
import { createRun, getGenerationScope, type Preparation, type Run } from './api';
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  createRun: vi.fn(),
  getGenerationScope: vi.fn(),
}));
const state: Preparation = {
  version: 1,
  fingerprint: 'snapshot',
  ready: true,
  evidence_review_id: 'evidence',
  selected_count: 0,
  design_id: 'design-a',
  template_job_id: null,
  slide_count: 2,
  generated: false,
};
const scope = {
  outline_revision_id: 'revision-a',
  sections: [
    { id: 'root', parent_id: null, title: '업무 현황' },
    { id: 'a', parent_id: 'root', title: '현황 요약' },
    { id: 'b', parent_id: 'root', title: '실행 계획' },
  ],
};
const methods = [
  'hasPointerCapture',
  'setPointerCapture',
  'releasePointerCapture',
  'scrollIntoView',
] as const;
const originals = methods.map(
  (name) => [name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)] as const,
);
const resizeObserver = globalThis.ResizeObserver;
beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  for (const name of methods)
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      value: name === 'hasPointerCapture' ? () => false : () => {},
    });
});
afterAll(() => {
  if (resizeObserver) globalThis.ResizeObserver = resizeObserver;
  else Reflect.deleteProperty(globalThis, 'ResizeObserver');
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
    else delete HTMLElement.prototype[name];
  }
});
let client: QueryClient;
afterEach(() => {
  cleanup();
  client?.clear();
  vi.clearAllMocks();
});
function mount() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.mocked(getGenerationScope).mockResolvedValue(scope);
  const created = vi.fn();
  const props = {
    project: 'project',
    name: '업무 발표',
    editable: true,
    active: true,
    busy: false,
    base: null,
    onCreated: created,
    onCancelBase: vi.fn(),
  };
  const tree = (input: Preparation) => (
    <QueryClientProvider client={client}>
      <GenerationForm {...props} state={input} />
    </QueryClientProvider>
  );
  const view = render(tree(state));
  return { created, rerender: (input: Preparation) => view.rerender(tree(input)) };
}
it('rejects an empty choice and sends only the selected leaf IDs with the request', async () => {
  const user = userEvent.setup();
  const { created } = mount();
  await screen.findByRole('checkbox', { name: '전체 목차' });
  await user.click(screen.getByRole('checkbox', { name: '전체 목차' }));
  await user.click(screen.getByRole('button', { name: 'PPT 만들기' }));
  expect(screen.getByRole('alert')).toHaveTextContent('생성할 목차를 하나 이상');
  expect(screen.getByRole('checkbox', { name: '전체 목차' })).toHaveFocus();
  expect(createRun).not.toHaveBeenCalled();
  await user.click(screen.getByRole('checkbox', { name: '업무 현황' }));
  await user.click(screen.getByRole('checkbox', { name: '현황 요약' }));
  expect(screen.queryByRole('combobox', { name: '작성에 사용할 AI' })).not.toBeInTheDocument();
  vi.mocked(createRun).mockResolvedValue({ id: 'run' } as Run);
  await user.click(screen.getByRole('button', { name: 'PPT 만들기' }));
  await waitFor(() => expect(created).toHaveBeenCalled());
  expect(createRun).toHaveBeenCalledWith(
    'project',
    expect.any(String),
    expect.objectContaining({ node_ids: ['b'], design_id: 'design-a' }),
  );
  const input = vi.mocked(createRun).mock.calls.at(0)?.[2];
  expect(input).toBeDefined();
  expect(input).not.toHaveProperty('connection_id');
  expect(input).not.toHaveProperty('model_version');
  expect(input).not.toHaveProperty('materials');
  expect(screen.queryByRole('button', { name: '레퍼런스 넣기' })).not.toBeInTheDocument();
});
it('requires explicit confirmation after the confirmed outline changes', async () => {
  const user = userEvent.setup();
  const { rerender } = mount();
  await user.click(await screen.findByRole('checkbox', { name: '현황 요약' }));
  vi.mocked(getGenerationScope).mockResolvedValue({ ...scope, outline_revision_id: 'revision-b' });
  await act(async () => rerender({ ...state, design_id: 'design-b', version: 2 }));
  await screen.findByRole('button', { name: '현재 목차로 다시 선택' });
  expect(screen.getByText('0개 선택 · 목차 기준 0장')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'PPT 만들기' }));
  expect(createRun).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: '현재 목차로 다시 선택' }));
  expect(screen.getByText('2개 선택 · 목차 기준 2장')).toBeInTheDocument();
});

it('preserves the writing draft and permits retry when the server has no writing connection', async () => {
  const user = userEvent.setup();
  mount();
  await screen.findByRole('checkbox', { name: '전체 목차' });
  vi.mocked(createRun).mockRejectedValue(
    new ApiError(
      422,
      'presentation_error',
      '발표자료를 작성할 AI가 준비되지 않았습니다. 관리자에게 연결 설정을 확인해 주세요.',
    ),
  );
  await user.type(screen.getByLabelText('이번 발표자료에 추가할 요청 (선택)'), '간결한 발표');
  await user.click(screen.getByRole('button', { name: 'PPT 만들기' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('관리자에게 연결 설정을 확인');
  expect(screen.getByLabelText('이번 발표자료에 추가할 요청 (선택)')).toHaveValue('간결한 발표');
  expect(screen.getByRole('checkbox', { name: '전체 목차' })).toBeChecked();
  expect(screen.getByRole('button', { name: 'PPT 만들기' })).toBeEnabled();
  expect(screen.queryByRole('combobox', { name: '작성에 사용할 AI' })).not.toBeInTheDocument();
});
