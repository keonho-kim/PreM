// Purpose: Verify capacity drafts, conflict review, valid writes and inactive-tab query ownership.
// Pattern: Real shadcn form controls with a feature API boundary and Query cache updates.
// Usage: Vitest; server/browser tests verify actual admission and shared persistence.
// Related: provider-capacity.tsx, capacity-api.ts, backend/tests/model_capacity.rs.
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProviderCapacity } from './provider-capacity';
import { capacityKey, getCapacity, saveCapacity, type Capacity } from './capacity-api';
import { ApiError } from '@/shared/api/http';
vi.mock('./capacity-api', async (original) => ({
  ...(await original<typeof import('./capacity-api')>()),
  getCapacity: vi.fn(),
  saveCapacity: vi.fn(),
}));
const id = 'f3920570-0367-46a1-9296-9a1329b9bce6';
const saved: Capacity = {
  connection_id: id,
  version: 0,
  max_parallel: 4,
  queue_capacity: 32,
  queue_timeout_seconds: 30,
  active: 1,
  queued: 2,
};
const clients: QueryClient[] = [];
function mount(active = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  vi.mocked(getCapacity).mockResolvedValue(saved);
  render(
    <QueryClientProvider client={client}>
      <ProviderCapacity providerId={id} active={active} />
    </QueryClientProvider>,
  );
  return client;
}
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((c) => {
    c.clear();
  });
  vi.resetAllMocks();
});
it('saves the edited limits with the original condition and confirms success', async () => {
  mount();
  const user = userEvent.setup();
  const input = await screen.findByLabelText('동시 처리 수 · 필수');
  await user.clear(input);
  await user.type(input, '8');
  vi.mocked(saveCapacity).mockResolvedValue({ ...saved, version: 1, max_parallel: 8 });
  await user.click(screen.getByRole('button', { name: '처리 설정 저장' }));
  await screen.findByText('처리 설정을 저장했습니다.');
  expect(saveCapacity).toHaveBeenCalledWith(id, 0, {
    max_parallel: 8,
    queue_capacity: 32,
    queue_timeout_seconds: 30,
  });
});
it('preserves a dirty draft during shared updates and requires explicit latest-setting review', async () => {
  const client = mount();
  const user = userEvent.setup();
  const input = await screen.findByLabelText('동시 처리 수 · 필수');
  await user.clear(input);
  await user.type(input, '8');
  const newer = { ...saved, version: 1, max_parallel: 2 };
  act(() => {
    client.setQueryData(capacityKey(id), newer);
  });
  expect(input).toHaveValue(8);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '처리 설정 저장' })).toBeDisabled(),
  );
  vi.mocked(getCapacity).mockResolvedValue(newer);
  await user.click(screen.getByRole('button', { name: '최신 설정 확인' }));
  await screen.findByText(/현재 저장된 값은 동시 2개/);
  expect(input).toHaveValue(8);
  vi.mocked(saveCapacity).mockResolvedValue({ ...newer, version: 2, max_parallel: 8 });
  await user.click(screen.getByRole('button', { name: '처리 설정 저장' }));
  await waitFor(() =>
    expect(saveCapacity).toHaveBeenCalledWith(id, 1, {
      max_parallel: 8,
      queue_capacity: 32,
      queue_timeout_seconds: 30,
    }),
  );
});
it('keeps inputs after an uncertain save and allows explicit cancellation of the draft', async () => {
  mount();
  const user = userEvent.setup();
  const input = await screen.findByLabelText('대기 가능한 요청 수 · 필수');
  await user.clear(input);
  await user.type(input, '0');
  vi.mocked(saveCapacity).mockRejectedValue(
    new ApiError(503, 'unavailable', '저장하지 못했습니다. 다시 시도하세요.'),
  );
  await user.click(screen.getByRole('button', { name: '처리 설정 저장' }));
  await screen.findByText('저장하지 못했습니다. 다시 시도하세요.');
  expect(input).toHaveValue(0);
  expect(saveCapacity).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole('button', { name: '입력 취소' }));
  expect(input).toHaveValue(32);
});
it('does not fetch or poll an inactive connection tab', () => {
  mount(false);
  expect(getCapacity).not.toHaveBeenCalled();
});
