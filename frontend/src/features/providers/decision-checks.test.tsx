// Purpose: Verify decision form validation, scoped calls, result clearing and abort ownership.
// Pattern: Real shadcn controls with an explicit API boundary and Query mutation state.
// Usage: Vitest; native wire contracts and persistence are covered by Rust/E2E tests.
// Related: decision-checks.tsx, decision-api.ts, provider-dialog.test.tsx.
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DecisionChecks } from './decision-checks';
import { evaluateDecision } from './decision-api';
import { catalogFixture } from './test-fixtures';
import type { Provider } from './api';
vi.mock('./decision-api', async (original) => ({
  ...(await original<typeof import('./decision-api')>()),
  evaluateDecision: vi.fn(),
}));
const provider: Provider = {
  id: 'f3920570-0367-46a1-9296-9a1329b9bce6',
  config_id: 'a63c8ae7-b705-454b-8c5a-4374a306ab15',
  version: 2,
  name: 'Fixture',
  provider_type: 'lm_studio',
  base_url: 'http://localhost/v1/',
  model_identifier: 'fixture',
  timeout_seconds: 5,
  enabled: true,
  has_secret: false,
  created_at: 1,
};
const clients: QueryClient[] = [];
function mount(index = 1) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  clients.push(client);
  const option = catalogFixture[index];
  if (!option) throw new Error('Missing fixture');
  return render(
    <QueryClientProvider client={client}>
      <DecisionChecks provider={provider} option={option} />
    </QueryClientProvider>,
  );
}
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((c) => {
    c.clear();
  });
  vi.resetAllMocks();
});
it('announces JSON errors only after submission and focuses the editor', async () => {
  mount();
  const user = userEvent.setup();
  const editor = screen.getByLabelText('질문과 선택지 (JSON) · 필수');
  expect(editor).toHaveAttribute('aria-invalid', 'false');
  await user.clear(editor);
  await user.type(editor, 'broken');
  expect(editor).toHaveAttribute('aria-invalid', 'false');
  await user.click(screen.getByRole('button', { name: '판정 실행' }));
  expect(editor).toHaveAttribute('aria-invalid', 'true');
  expect(editor).toHaveFocus();
  expect(evaluateDecision).not.toHaveBeenCalled();
  await user.clear(editor);
  expect(editor).toHaveAttribute('aria-invalid', 'false');
});
it('pins the saved version, sends one batch and clears stale output on edits', async () => {
  mount();
  const user = userEvent.setup();
  vi.mocked(evaluateDecision).mockResolvedValue({
    request: {
      id: provider.id,
      config_id: provider.config_id,
      kind: 'decision',
      status: 'succeeded',
      elapsed_ms: 8,
      prompt_tokens: 10,
      completion_tokens: 5,
      error_code: null,
      created_at: 1,
    },
    result: {
      model: 'fixture',
      statistics: 'unavailable',
      answers: { is_table_of_contents: { choice: '1', probabilities: null, confidence: null } },
    },
  });
  await user.click(screen.getByRole('button', { name: '판정 실행' }));
  await screen.findByText('LLM 선택값입니다. 확률은 제공하지 않습니다.');
  expect(evaluateDecision).toHaveBeenCalledOnce();
  expect(vi.mocked(evaluateDecision).mock.calls[0]?.[0].version).toBe(2);
  await user.type(screen.getByLabelText('판정할 내용 · 필수'), ' revised');
  expect(screen.queryByText('LLM 선택값입니다. 확률은 제공하지 않습니다.')).not.toBeInTheDocument();
});
it('aborts response waiting on unmount and blocks unsupported LLM connections', async () => {
  const view = mount();
  const user = userEvent.setup();
  vi.mocked(evaluateDecision).mockImplementation(() => new Promise(() => {}));
  await user.click(screen.getByRole('button', { name: '판정 실행' }));
  await waitFor(() => expect(evaluateDecision).toHaveBeenCalledOnce());
  const signal = vi.mocked(evaluateDecision).mock.calls[0]?.[3];
  view.unmount();
  expect(signal?.aborted).toBe(true);
  mount(0);
  expect(screen.getByRole('button', { name: '판정 실행' })).toBeDisabled();
});
