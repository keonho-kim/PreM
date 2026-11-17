// Purpose: Verify tab transitions preserve test state and history reads stay view-scoped.
// Pattern: Real Admin composition and shadcn tabs with controlled feature APIs.
// Usage: Vitest; browser E2E covers side navigation, keyboard, reload and viewport changes.
// Related: admin-page.tsx, features/providers/provider-checks.tsx, tests/e2e/admin-navigation.cjs.
import { renderRouted as render } from '@/test/render-routed';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterTestHarness } from '@/test/router';
import { AdminPage } from './admin-page';
import { grantAdminAccess } from '@/shared/api/admin-credential';
beforeEach(() => grantAdminAccess('synthetic-admin-token'));
import { catalogFixture } from '@/features/providers/test-fixtures';
import {
  getProviderCatalog,
  listProviders,
  getHistory,
  testProvider,
} from '@/features/providers/api';
vi.mock('@/features/document-processing', () => ({
  ProcessingSettings: () => <p>공통 판정 모델</p>,
}));
vi.mock('@/features/providers/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/providers/api')>()),
  listProviders: vi.fn(),
  getProviderCatalog: vi.fn(),
  getHistory: vi.fn(),
  testProvider: vi.fn(),
}));
const clients: QueryClient[] = [];
const provider = {
  id: 'f3920570-0367-46a1-9296-9a1329b9bce6',
  config_id: 'a63c8ae7-b705-454b-8c5a-4374a306ab15',
  version: 1,
  name: '테스트 연결',
  provider_type: 'lm_studio' as const,
  base_url: 'http://localhost:1234/v1/',
  model_identifier: 'ornith-1.5-35b-a3b',
  timeout_seconds: 180,
  enabled: true,
  has_secret: false,
  created_at: 1,
};
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => {
    client.clear();
  });
  vi.resetAllMocks();
});
it('does not query hidden history and keeps a running test alive when switching tabs', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  vi.mocked(getProviderCatalog).mockResolvedValue(catalogFixture);
  vi.mocked(listProviders).mockResolvedValue([provider]);
  vi.mocked(getHistory).mockResolvedValue([]);
  let signal: AbortSignal | undefined;
  let finish: (value: Awaited<ReturnType<typeof testProvider>>) => void = () => {};
  vi.mocked(testProvider).mockImplementation((_provider, _kind, requestSignal) => {
    signal = requestSignal;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  await render(
    <RouterTestHarness initialEntries={['/admin']}>
      <QueryClientProvider client={client}>
        <AdminPage />
      </QueryClientProvider>
    </RouterTestHarness>,
  );
  await screen.findByRole('tab', { name: '연결 설정' });
  expect(getHistory).not.toHaveBeenCalled();
  const user = userEvent.setup();
  await user.click(screen.getByRole('tab', { name: '연결 테스트' }));
  await user.click(screen.getByRole('button', { name: '텍스트 테스트' }));
  await waitFor(() => expect(testProvider).toHaveBeenCalledOnce());
  await user.click(screen.getByRole('tab', { name: '요청 이력' }));
  await waitFor(() => expect(getHistory).toHaveBeenCalled());
  expect(signal?.aborted).toBe(false);
  finish({
    text: 'PreM connection OK',
    request: {
      id: provider.id,
      config_id: provider.config_id,
      kind: 'text',
      status: 'succeeded',
      elapsed_ms: 5,
      prompt_tokens: 1,
      completion_tokens: 1,
      error_code: null,
      created_at: 1,
    },
  });
  await user.click(screen.getByRole('tab', { name: '연결 테스트' }));
  await screen.findByText('PreM connection OK');
  expect(testProvider).toHaveBeenCalledOnce();
  expect(document.querySelectorAll('main')).toHaveLength(1);
});

it('blocks setup until the server catalog loads and offers an explicit retry after failure', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  vi.mocked(listProviders).mockResolvedValue([]);
  vi.mocked(getProviderCatalog)
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(catalogFixture);
  await render(
    <RouterTestHarness>
      <QueryClientProvider client={client}>
        <AdminPage />
      </QueryClientProvider>
    </RouterTestHarness>,
  );
  await screen.findByRole('button', { name: '다시 시도' });
  expect(screen.queryByRole('combobox', { name: 'Provider' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'AI 모델 추가' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '다시 시도' }));
  await waitFor(() =>
    expect(screen.getByRole('link', { name: 'Decision Model 연결' })).toBeEnabled(),
  );
  await userEvent.click(screen.getByRole('link', { name: 'Decision Model 연결' }));
  await screen.findByText('문서 처리와 자료 찾기에 사용할 모델입니다.');
  expect(screen.getByRole('combobox', { name: 'Provider' })).toHaveTextContent(
    'LM Studio · OpenAI 호환',
  );
  expect(screen.getByRole('combobox', { name: '사용할 모델 · 필수' })).toBeEnabled();
});
