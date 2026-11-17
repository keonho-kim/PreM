// Purpose: Verify explicit evidence confirmation and idempotent uncertain generation retries.
// Pattern: Real feature controls with transport fixtures; Rust/browser tests own renderer quality.
// Usage: Vitest; no live models, credentials or persistent browser storage.
// Related: evidence-confirmation.tsx, generation.tsx, api.ts.
import { renderRouted as render } from '@/test/render-routed';
import '@testing-library/jest-dom/vitest';
import { it, expect, vi, afterEach, beforeEach } from 'vitest';
import { screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterTestHarness } from '@/test/router';
import { EvidenceConfirmation } from './evidence-confirmation';
import { Generation } from './generation';
import { confirmEvidence, createRun, listRuns, type Preparation, type Run } from './api';
vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  confirmEvidence: vi.fn(),
  createRun: vi.fn(),
  getGenerationScope: async () => ({
    outline_revision_id: 'revision',
    sections: [
      { id: 'a', parent_id: null, title: '현황' },
      { id: 'b', parent_id: null, title: '계획' },
    ],
  }),
  listRuns: vi.fn(async (): Promise<Run[]> => []),
}));
vi.mock('@/features/outlines', () => ({
  outlineKeys: { all: ['outlines'] },
  OutlineRevisionDialog: () => null,
}));
vi.mock('./deck-preview', () => ({
  DeckPreview: () => <section aria-label="슬라이드 편집기" />,
}));
vi.mock('@/features/providers', () => ({
  authoringModelsKey: ['authoring-models'],
  listAuthoringModels: async () => [
    { id: 'model', enabled: true, provider_type: 'openai_compatible', name: '작성 AI', version: 1 },
  ],
  getProviderCatalog: async () => [{ id: 'openai_compatible', category: 'llm' }],
}));
const state: Preparation = {
  version: 1,
  fingerprint: 'fixed-inputs',
  ready: true,
  evidence_review_id: 'review',
  selected_count: 0,
  design_id: 'design',
  template_job_id: null,
  slide_count: 2,
  generated: false,
};
const methods = [
  'hasPointerCapture',
  'setPointerCapture',
  'releasePointerCapture',
  'scrollIntoView',
] as const;
const originals = methods.map((name) =>
  Object.getOwnPropertyDescriptor(HTMLElement.prototype, name),
);
const resizeObserver = globalThis.ResizeObserver;
beforeEach(() => {
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
const clients: QueryClient[] = [];
async function mount(view: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  await render(
    <RouterTestHarness>
      <QueryClientProvider client={client}>{view}</QueryClientProvider>
    </RouterTestHarness>,
  );
}
afterEach(() => {
  if (resizeObserver) globalThis.ResizeObserver = resizeObserver;
  else Reflect.deleteProperty(globalThis, 'ResizeObserver');
  cleanup();
  for (const c of clients.splice(0)) c.clear();
  vi.clearAllMocks();
  vi.mocked(listRuns).mockResolvedValue([]);
  methods.forEach((name, i) => {
    const original = originals[i];
    if (original) Object.defineProperty(HTMLElement.prototype, name, original);
    else Reflect.deleteProperty(HTMLElement.prototype, name);
  });
});
it('does not confirm empty additional evidence until the user explicitly continues', async () => {
  const next = vi.fn();
  vi.mocked(confirmEvidence).mockResolvedValue(state);
  await mount(<EvidenceConfirmation project="p" state={state} editable onContinue={next} />);
  expect(screen.getByText('현재 프로젝트 원본으로 작성')).toBeVisible();
  expect(confirmEvidence).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: '근거 확인하고 계속' }));
  await waitFor(() => expect(next).toHaveBeenCalledTimes(1));
  expect(confirmEvidence).toHaveBeenCalledWith('p', 'fixed-inputs');
});
it('retains one generation receipt when a sent request has an uncertain response', async () => {
  vi.mocked(createRun).mockRejectedValue(new Error('temporary failure'));
  await mount(<Generation project="p" name="보고서" state={state} editable active />);
  expect(screen.queryByRole('combobox', { name: '작성에 사용할 AI' })).not.toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('이번 발표자료에 추가할 요청 (선택)'), '간결한 구성');
  expect(screen.queryByRole('button', { name: 'PPT 생성 설정' })).not.toBeInTheDocument();
  expect(screen.getByLabelText('이번 발표자료에 추가할 요청 (선택)')).toHaveValue('간결한 구성');
  expect(createRun).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'PPT 만들기' }));
  await screen.findByRole('alert');
  await userEvent.click(screen.getByRole('button', { name: 'PPT 만들기' }));
  await waitFor(() => expect(createRun).toHaveBeenCalledTimes(2));
  expect(vi.mocked(createRun).mock.calls[0]).toEqual(vi.mocked(createRun).mock.calls[1]);
});

it('keeps the current editor ahead of inline creation and opens version authoring directly', async () => {
  const run: Run = {
    id: 'run',
    project_id: 'p',
    presentation_id: 'deck',
    presentation_version: 1,
    is_current: true,
    title: '현재 발표',
    status: 'succeeded',
    stage: 'complete',
    version: 1,
    completed: 2,
    total: 2,
    error_code: null,
    created_at: 1,
  };
  vi.mocked(listRuns).mockResolvedValue([run]);
  await mount(<Generation project="p" name="보고서" state={state} editable active />);
  const editor = await screen.findByRole('region', { name: '슬라이드 편집기' });
  const composer = screen.getByRole('region', { name: '발표자료 만들기' });
  expect(editor.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByRole('checkbox', { name: '전체 목차' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'PPT 생성 설정' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '이 발표자료 새 버전 만들기' }));
  expect(screen.queryByRole('tab', { name: '직접 작성' })).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByLabelText('발표자료 제목')).toHaveFocus());
  expect(screen.getByLabelText('발표자료 제목')).toHaveValue('현재 발표');
  expect(screen.getByRole('button', { name: '새 버전 만들기' })).toBeVisible();
  expect(createRun).not.toHaveBeenCalled();
});
