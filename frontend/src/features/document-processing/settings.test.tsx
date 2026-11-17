// Purpose: Preserve the reviewed default-model version across concurrent settings refreshes.
// Pattern: Real settings UI and Query cache with mocked persistence boundaries.
// Usage: Vitest; shared HTTP/SQLite CAS is covered by shared_decision_settings.rs.
// Related: settings.tsx, api.ts.
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { cleanup, render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProcessingSettings } from './settings';
import { saveSettings } from './api';
vi.mock('./api', () => ({
  processingKeys: { settings: ['processing-settings'], all: ['processing'] },
  getSettings: vi.fn(async () => ({ version: 1, connection_id: null })),
  saveSettings: vi.fn(async () => ({ version: 2, connection_id: null })),
}));
vi.mock('@/features/providers', () => ({
  providerKeys: { all: ['providers'], catalog: ['provider-types'] },
  listProviders: vi.fn(async () => [
    { id: 'fixture', name: '판정 모델', provider_type: 'native', enabled: true },
  ]),
  getProviderCatalog: vi.fn(async () => [{ id: 'native', category: 'system', structured: false }]),
}));
beforeAll(() => {
  HTMLElement.prototype.hasPointerCapture = () => false;
  HTMLElement.prototype.setPointerCapture = () => {};
  HTMLElement.prototype.releasePointerCapture = () => {};
  HTMLElement.prototype.scrollIntoView = () => {};
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it('keeps the original version when another browser changes the common default', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <ProcessingSettings />
    </QueryClientProvider>,
  );
  const select = await screen.findByRole('combobox', { name: '사용할 판정 연결' });
  await user.click(select);
  await user.click(await screen.findByRole('option', { name: '판정 모델 · System One' }));
  act(() => {
    client.setQueryData(['processing-settings'], { version: 2, connection_id: 'another' });
  });
  await user.click(screen.getByRole('button', { name: '판정 연결 적용' }));
  await waitFor(() => expect(saveSettings).toHaveBeenCalledWith(1, 'fixture'));
  client.clear();
});
