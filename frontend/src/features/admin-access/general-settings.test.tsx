// Purpose: Verify temporary Admin token changes require matching input and explicit confirmation.
// Pattern: Real settings form with a mocked API and version-checked mutation assertions.
// Usage: Vitest; server/browser tests cover actual invalidation and restart reset.
// Related: general-settings.tsx, backend/tests/admin_access.rs.
import '@testing-library/jest-dom/vitest';
import { it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GeneralSettings } from './general-settings';
import { request } from '@/shared/api/http';
import { readAdminToken, grantAdminAccess, clearAdminAccess } from '@/shared/api/admin-credential';
vi.mock('@/shared/api/http', async (original) => ({
  ...(await original<typeof import('@/shared/api/http')>()),
  request: vi.fn(),
}));
vi.mock('@/shared/notifications', () => ({ notify: vi.fn() }));
let client: QueryClient;
afterEach(() => {
  cleanup();
  clearAdminAccess();
  client.clear();
  vi.clearAllMocks();
});
it('keeps the old token on cancel, then changes only the in-memory Admin credential', async () => {
  vi.mocked(request).mockResolvedValue({ version: 1 });
  grantAdminAccess('old-test-token');
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <GeneralSettings />
    </QueryClientProvider>,
  );
  await userEvent.type(await screen.findByLabelText('새 Admin 토큰'), 'new-test-token-123');
  await userEvent.type(screen.getByLabelText('새 토큰 확인'), 'wrong-test-token-123');
  await userEvent.click(screen.getByRole('button', { name: 'Admin 토큰 변경' }));
  await screen.findByRole('alert');
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  await userEvent.clear(screen.getByLabelText('새 토큰 확인'));
  await userEvent.type(screen.getByLabelText('새 토큰 확인'), 'new-test-token-123');
  await userEvent.click(screen.getByRole('button', { name: 'Admin 토큰 변경' }));
  expect(screen.getByRole('alertdialog')).not.toHaveTextContent('new-test-token-123');
  await userEvent.click(screen.getByRole('button', { name: '취소' }));
  expect(readAdminToken()).toBe('old-test-token');
  expect(
    vi.mocked(request).mock.calls.filter(([, , options]) => options?.method === 'PUT'),
  ).toHaveLength(0);
  await userEvent.click(screen.getByRole('button', { name: 'Admin 토큰 변경' }));
  await userEvent.click(screen.getByRole('button', { name: '확인하고 변경' }));
  await waitFor(() => expect(readAdminToken()).toBeNull());
  const call = vi.mocked(request).mock.calls.find(([, , options]) => options?.method === 'PUT');
  expect(JSON.parse(call?.[2]?.body ?? '{}')).toEqual({
    expected_version: 1,
    token: 'new-test-token-123',
  });
});
