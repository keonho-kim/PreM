// Purpose: Verify explicit evidence confirmation and idempotent uncertain generation retries.
// Pattern: Real feature controls with transport fixtures; Rust/browser tests own renderer quality.
// Usage: Vitest; no live models, credentials or persistent browser storage.
// Related: evidence-confirmation.tsx, generation.tsx, api.ts.
import '@testing-library/jest-dom/vitest';
import { it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { EvidenceConfirmation } from './evidence-confirmation';
import { Generation } from './generation';
import { confirmEvidence, createRun, type Preparation } from './api';
vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  confirmEvidence: vi.fn(),
  createRun: vi.fn(),
  listRuns: async () => [],
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
beforeEach(() => {
  for (const name of methods)
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      value: name === 'hasPointerCapture' ? () => false : () => {},
    });
});
const clients: QueryClient[] = [];
function mount(view: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>{view}</QueryClientProvider>
    </MemoryRouter>,
  );
}
afterEach(() => {
  cleanup();
  for (const c of clients.splice(0)) c.clear();
  vi.clearAllMocks();
  methods.forEach((name, i) => {
    const original = originals[i];
    if (original) Object.defineProperty(HTMLElement.prototype, name, original);
    else Reflect.deleteProperty(HTMLElement.prototype, name);
  });
});
it('does not confirm empty additional evidence until the user explicitly continues', async () => {
  const next = vi.fn();
  vi.mocked(confirmEvidence).mockResolvedValue(state);
  mount(<EvidenceConfirmation project="p" state={state} editable onContinue={next} />);
  expect(screen.getByText('현재 프로젝트 원본으로 작성')).toBeVisible();
  expect(confirmEvidence).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: '근거 확인하고 계속' }));
  await waitFor(() => expect(next).toHaveBeenCalledTimes(1));
  expect(confirmEvidence).toHaveBeenCalledWith('p', 'fixed-inputs');
});
it('retains one generation receipt when a sent request has an uncertain response', async () => {
  vi.mocked(createRun).mockRejectedValue(new Error('temporary failure'));
  mount(<Generation project="p" name="보고서" state={state} editable active />);
  await userEvent.click(screen.getByRole('combobox', { name: '작성에 사용할 AI' }));
  await userEvent.click(await screen.findByRole('option', { name: '작성 AI' }));
  await userEvent.type(screen.getByLabelText('이번 발표자료에 추가할 요청 (선택)'), '간결한 구성');
  await userEvent.click(screen.getByRole('button', { name: 'PPT 생성 설정' }));
  expect(
    screen.queryByRole('textbox', { name: '이번 발표자료에 추가할 요청 (선택)' }),
  ).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'PPT 생성 설정' }));
  expect(screen.getByLabelText('이번 발표자료에 추가할 요청 (선택)')).toHaveValue('간결한 구성');
  expect(createRun).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'PPT 만들기' }));
  await screen.findByRole('alert');
  await userEvent.click(screen.getByRole('button', { name: 'PPT 만들기' }));
  await waitFor(() => expect(createRun).toHaveBeenCalledTimes(2));
  expect(vi.mocked(createRun).mock.calls[0]).toEqual(vi.mocked(createRun).mock.calls[1]);
});
