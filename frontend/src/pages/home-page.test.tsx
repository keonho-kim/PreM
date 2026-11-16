// Purpose: Verify the health screen's real response boundary and query cancellation.
// Pattern: Isolated Query clients, DOM interaction and a controlled Axios adapter.
// Usage: pnpm --filter @puputyx/frontend test.
// Related: pages/home-page.tsx, lib/api.ts, vitest.config.ts.
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { screen } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HomePage } from './home-page';
const transport = vi.hoisted(() => vi.fn());
vi.mock('axios', async (importOriginal) => {
  const { default: axios } = await importOriginal<typeof import('axios')>();
  return {
    default: {
      create: (options: Parameters<typeof axios.create>[0]) =>
        axios.create({ ...options, adapter: transport }),
    },
  };
});

const clients: QueryClient[] = [];
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <HomePage />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => {
    client.clear();
  });
  vi.unstubAllGlobals();
  transport.mockReset();
});

describe('service connection', () => {
  it('rejects an invalid health response and recovers after an explicit retry', async () => {
    transport
      .mockResolvedValueOnce({ status: 200, data: { status: 'ok', service: 'Wrong service' } })
      .mockResolvedValueOnce({
        status: 200,
        data: { status: 'ok', service: 'PuPuTyX', version: '0.1.0' },
      });
    const user = userEvent.setup();
    mount();
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('서버에 연결할 수 없습니다'),
    );
    await user.click(screen.getByRole('button', { name: '연결 확인' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('서버에 연결되었습니다'),
    );
    expect(screen.getByText('0.1.0')).toBeVisible();
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls[0]?.[0].url).toBe('/healthz');
  });

  it('aborts an unfinished request when the screen unmounts', async () => {
    let requestSignal: AbortSignal | undefined;
    transport.mockImplementation(
      (init: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          requestSignal = init.signal ?? undefined;
          requestSignal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        }),
    );
    const view = mount();
    await waitFor(() => expect(requestSignal).toBeDefined());
    expect(screen.getByRole('button', { name: '연결 확인' })).toBeDisabled();
    view.unmount();
    expect(requestSignal?.aborted).toBe(true);
  });
});
