// Purpose: Verify independent panel collapse preserves slide selection and the active inspector tab.
// Pattern: Real Radix controls with canonical API fixtures; browser tests own grid sizing/stickiness.
// Usage: Vitest; no backend changes or simulated editor write commands.
// Related: deck-preview.tsx, deck-inspector.tsx, tests/e2e/presentations.cjs.
import '@testing-library/jest-dom/vitest';
import { it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DeckPreview } from './deck-preview';
import type { Run } from './api';
vi.mock('./slide-chat', () => ({ SlideChat: () => null }));
vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  listSlides: async () =>
    [1, 2].map((n) => ({
      id: `slide-${n}`,
      position: n,
      preview: true,
      spec: {
        schema_version: 1,
        title: `슬라이드 제목 ${n}`,
        bullets: ['업무 내용'],
        notes: `발표 메모 ${n}`,
        block_ids: [],
      },
    })),
  getCitations: async () => [],
}));
const run: Run = {
  id: 'run',
  project_id: 'project',
  presentation_id: 'deck',
  presentation_version: 1,
  is_current: true,
  title: '발표자료',
  status: 'succeeded',
  stage: 'complete',
  version: 3,
  completed: 2,
  total: 2,
  error_code: null,
  created_at: 0,
};
let client: QueryClient;
afterEach(() => {
  cleanup();
  client.clear();
  vi.unstubAllGlobals();
});
it('keeps panels mounted and restores the selected slide and reference tab when reopened', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <DeckPreview project="project" run={run} active canEdit onResult={() => {}} />
    </QueryClientProvider>,
  );
  await screen.findByRole('button', { name: '슬라이드 1: 슬라이드 제목 1' });
  await userEvent.click(screen.getByRole('button', { name: '다음 슬라이드' }));
  const second = screen.getByRole('button', { name: '슬라이드 2: 슬라이드 제목 2' });
  expect(second).toHaveAttribute('aria-pressed', 'true');
  await userEvent.click(screen.getByRole('tab', { name: '참고 자료' }));
  const left = screen.getByRole('complementary', { name: '슬라이드 목록 패널' }),
    right = screen.getByRole('complementary', { name: '현재 슬라이드 정보' });
  await userEvent.click(screen.getByRole('button', { name: '슬라이드 목록 접기' }));
  expect(left).toBeInTheDocument();
  expect(left).not.toBeVisible();
  expect(right).toBeVisible();
  const openLeft = screen.getByRole('button', { name: '슬라이드 목록 펼치기' });
  expect(openLeft).toHaveAttribute('aria-expanded', 'false');

  await userEvent.click(screen.getByRole('button', { name: '슬라이드 정보 패널 접기' }));
  expect(right).not.toBeVisible();
  await userEvent.click(openLeft);
  expect(openLeft).toHaveAttribute('aria-controls', left.id);
  expect(second).toHaveAttribute('aria-pressed', 'true');
  const openRight = screen.getByRole('button', { name: '슬라이드 정보 패널 펼치기' });
  openRight.focus();
  await userEvent.keyboard('{Enter}');
  await waitFor(() => expect(right).toBeVisible());
  expect(screen.getByRole('tab', { name: '참고 자료' })).toHaveAttribute('aria-selected', 'true');
  expect(openRight).toHaveFocus();
});
it('waits for a published run before requesting reused slide previews', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const view = (status: Run['status']) => (
    <QueryClientProvider client={client}>
      <DeckPreview project="project" run={{ ...run, status }} active canEdit onResult={() => {}} />
    </QueryClientProvider>
  );
  const { container, rerender } = render(view('running'));
  await screen.findByRole('button', { name: '슬라이드 1: 슬라이드 제목 1' });
  expect(container.querySelectorAll('img')).toHaveLength(0);
  rerender(view('succeeded'));
  expect(container.querySelectorAll('img')).toHaveLength(3);
});
