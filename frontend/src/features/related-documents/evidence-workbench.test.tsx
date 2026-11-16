// Purpose: Verify mobile evidence reading preserves selection commands and return focus.
// Pattern: Real controls with synthetic read-only evidence and platform scroll spies.
// Usage: Vitest; real-server browser tests own responsive sizing and CSS visibility.
// Related: evidence-workbench.tsx, tests/e2e/related-exploration.cjs.
import '@testing-library/jest-dom/vitest';
import { afterEach, it, expect, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { EvidenceWorkbench } from './evidence-workbench';
import type { RelatedItem } from './api';
vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  getEvidence: async () => [],
}));
const item: RelatedItem = {
  id: 'candidate',
  kind: 'file',
  relation: 2,
  excerpt: '검토할 내용',
  page_label: '1쪽',
  page_id: 'page',
  preview: null,
  origin_count: 1,
  project_count: 1,
  selection_id: 'selection',
  selection_version: 0,
  selected: false,
  origins: [
    {
      source_version_id: 'source',
      project_id: 'past',
      project_name: '지난 발표',
      item_id: 'file',
      item_version: 1,
      file_version: 1,
      filename: '업무 보고서',
      job_id: 'job',
      available: true,
    },
  ],
};
let client: QueryClient;
const scrollMethods = ['scrollIntoView', 'scrollTo'] as const;
const originalMethods = scrollMethods.map((name) =>
  Object.getOwnPropertyDescriptor(HTMLElement.prototype, name),
);
afterEach(() => {
  cleanup();
  client?.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  scrollMethods.forEach((name, index) => {
    const original = originalMethods[index];
    if (original) Object.defineProperty(HTMLElement.prototype, name, original);
    else Reflect.deleteProperty(HTMLElement.prototype, name);
  });
});
it('returns to the title and saved scroll position without changing reference selection', async () => {
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal('scrollY', 420);
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const select = vi.fn();
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <EvidenceWorkbench
          project="current"
          items={[item]}
          query=""
          editable
          stale={false}
          pending={false}
          active
          onSelect={select}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  const title = screen.getByRole('button', { name: '업무 보고서' });
  await userEvent.click(title);
  expect(screen.getByRole('button', { name: '목록으로' })).toHaveFocus();
  await screen.findByText('표시할 원문이 없습니다.');
  await userEvent.click(screen.getByRole('button', { name: '근거로 선택' }));
  expect(select).toHaveBeenCalledExactlyOnceWith(item);
  await userEvent.click(screen.getByRole('button', { name: '목록으로' }));
  expect(title).toHaveFocus();
  expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 420, behavior: 'instant' });
  await userEvent.keyboard('{Enter}');
  expect(screen.getByRole('button', { name: '목록으로' })).toHaveFocus();
  expect(select).toHaveBeenCalledTimes(1);
});
