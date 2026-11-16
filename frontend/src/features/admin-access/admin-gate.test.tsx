// Purpose: Verify explicit credential entry, private child mounting and memory/cache cleanup.
// Pattern: Real shadcn form with a mocked verification transport; browser tests cover HTTP gates.
// Usage: Vitest; fixture tokens are never stored in browser persistence.
// Related: admin-gate.tsx, shared/api/admin-credential.ts, tests/e2e/admin-access.cjs.
import '@testing-library/jest-dom/vitest';
import { it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AdminGate } from './admin-gate';
import { request, ApiError } from '@/shared/api/http';
import { readAdminToken, clearAdminAccess } from '@/shared/api/admin-credential';
vi.mock('@/shared/api/http', async (original) => ({
  ...(await original<typeof import('@/shared/api/http')>()),
  request: vi.fn(),
}));
let client: QueryClient;
function mount() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AdminGate>
        <h1>관리 설정</h1>
      </AdminGate>
    </QueryClientProvider>,
  );
}
afterEach(() => {
  cleanup();
  clearAdminAccess();
  client.clear();
  vi.clearAllMocks();
});
it('keeps Admin unmounted until verification and purges sensitive data on lock/exit', async () => {
  vi.mocked(request).mockResolvedValue({ authenticated: true });
  const view = mount();
  expect(screen.queryByRole('heading', { name: '관리 설정' })).not.toBeInTheDocument();
  const input = screen.getByLabelText('Admin 토큰');
  expect(input).toHaveAttribute('type', 'password');
  expect(input).toHaveAttribute('autocomplete', 'current-password');
  await userEvent.type(input, 'test-token');
  expect(request).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Admin 열기' }));
  await screen.findByRole('heading', { name: '관리 설정' });
  expect(readAdminToken()).toBe('test-token');
  client.setQueryData(['providers'], [{ base_url: 'private' }]);
  client.setQueryData(['authoring-models'], []);
  await userEvent.click(screen.getByRole('button', { name: 'Admin 잠그기' }));
  expect(readAdminToken()).toBeNull();
  expect(client.getQueryData(['providers'])).toBeUndefined();
  expect(client.getQueryData(['authoring-models'])).toEqual([]);
  await userEvent.type(screen.getByLabelText('Admin 토큰'), 'another-token');
  await userEvent.click(screen.getByRole('button', { name: 'Admin 열기' }));
  await screen.findByRole('heading', { name: '관리 설정' });
  view.unmount();
  expect(readAdminToken()).toBeNull();
});
it('shows rejected credentials and returns focus without mounting private views', async () => {
  vi.mocked(request).mockRejectedValue(
    new ApiError(401, 'admin_access_required', '토큰을 확인하세요.'),
  );
  mount();
  await userEvent.type(screen.getByLabelText('Admin 토큰'), 'wrong');
  await userEvent.click(screen.getByRole('button', { name: 'Admin 열기' }));
  await screen.findByRole('alert');
  await waitFor(() => expect(screen.getByLabelText('Admin 토큰')).toHaveFocus());
  expect(readAdminToken()).toBeNull();
  expect(screen.queryByText('관리 설정')).not.toBeInTheDocument();
});

it('clears an unfinished entry on page exit and rejects its late verification response', async () => {
  let finish: (value: unknown) => void = () => {};
  vi.mocked(request).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  mount();
  await userEvent.type(screen.getByLabelText('Admin 토큰'), 'unfinished-token');
  await userEvent.click(screen.getByRole('button', { name: 'Admin 열기' }));
  expect(screen.getByRole('button', { name: '확인 중…' })).toBeDisabled();
  fireEvent(window, new Event('pagehide'));
  expect(screen.getByLabelText('Admin 토큰')).toHaveValue('');
  expect(screen.getByRole('button', { name: 'Admin 열기' })).toBeEnabled();
  await act(async () => finish({ authenticated: true }));
  expect(readAdminToken()).toBeNull();
  expect(screen.queryByText('관리 설정')).not.toBeInTheDocument();
});
