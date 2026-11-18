// Purpose: Verify user-invoked notifications and tab-local queue presentation.
// Pattern: Real Uppy state with transmission disabled; public UI behavior through shadcn.
// Usage: Vitest; cross-browser isolation and route continuity are covered by Space E2E.
// Related: upload-work-panel.tsx, upload-engine.ts, tests/e2e/space.cjs.
import { renderRouted as render } from '@/test/render-routed';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { uploadJobOptions, type ProcessingJob as Job } from '@/features/document-processing';
import { RouterTestHarness } from '@/test/router';
import { createUploadEngine } from './upload-engine';
import { useUploadEngine } from './use-upload-engine';
import { UploadWorkPanel } from './upload-work-panel';
vi.mock('./use-upload-engine', () => ({ useUploadEngine: vi.fn() }));
// jsdom has no layout observer; actual arrow positioning is verified in browser E2E.
beforeEach(() =>
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  ),
);
const engines: ReturnType<typeof createUploadEngine>[] = [];
async function mount() {
  const engine = createUploadEngine(vi.fn());
  engine.uppy.setOptions({ autoProceed: false });
  engines.push(engine);
  vi.mocked(useUploadEngine).mockReturnValue(engine);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const view = await render(
    <RouterTestHarness>
      <QueryClientProvider client={client}>
        <UploadWorkPanel />
      </QueryClientProvider>
    </RouterTestHarness>,
  );
  return { engine, client, ...view };
}
afterEach(() => {
  cleanup();
  engines.splice(0).forEach((engine) => {
    engine.dispose();
  });
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
it('keeps the work queue alive through collapse, close, reopen and completion', async () => {
  const user = userEvent.setup();
  const { engine, client } = await mount();
  expect(screen.queryByRole('region', { name: '작업 진행 상황' })).not.toBeInTheDocument();
  act(() => engine.add([new File(['data'], 'own.pdf')], 'references', '', []));
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  expect(engine.uppy.getFiles()).toHaveLength(1);
  await user.click(screen.getByRole('button', { name: '작업 패널 펼치기' }));
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  await user.click(screen.getByRole('button', { name: '작업 패널 닫기' }));
  const reopen = screen.getByRole('button', { name: '작업 1개 보기' });
  expect(reopen).toHaveFocus();
  await user.click(reopen);
  const file = engine.uppy.getFiles()[0];
  if (!file) throw new Error('missing file');
  const finished: Job = {
    id: 'job',
    item_id: 'item',
    kind: 'references',
    file_version: 1,
    status: 'succeeded',
    version: 3,
    attempt: 1,
    extraction_id: null,
    config_id: null,
    error_code: null,
    created_at: 0,
    updated_at: 1,
    total_blocks: 0,
    completed_blocks: 0,
  };
  const key = uploadJobOptions('references', 'item', 1).queryKey;
  const reading: Job = { ...finished, status: 'extracting' };
  client.setQueryData(key, reading);
  act(() =>
    engine.uppy.setFileState(file.id, {
      progress: { ...file.progress, uploadComplete: true, percentage: 100 },
      response: { status: 201, body: { id: 'item', file_version: 1, version: 1 } },
    }),
  );
  await screen.findByRole('progressbar', { name: '문서 읽기 진행 중' });
  expect(screen.getByRole('button', { name: '완료 항목 정리' })).toBeDisabled();
  act(() => engine.add([new File(['more'], 'next.pdf')], 'references', '', []));
  act(() => {
    client.setQueryData(key, finished);
  });
  await screen.findByText('자료 준비 완료');
  await user.click(screen.getByRole('button', { name: '완료 항목 정리' }));
  expect(screen.getByText('next.pdf')).toBeVisible();
  expect(screen.queryByText('own.pdf')).toBeNull();
  const second: Job = { ...finished, item_id: 'second' };
  client.setQueryData(uploadJobOptions('references', 'second', 1).queryKey, second);
  const next = engine.uppy.getFiles()[0];
  if (!next) throw new Error('pending file missing');
  act(() =>
    engine.uppy.setFileState(next.id, {
      progress: { ...next.progress, uploadComplete: true, percentage: 100 },
      response: { status: 201, body: { id: 'second', file_version: 1, version: 1 } },
    }),
  );
  await screen.findByText('자료 준비 완료');
  await user.click(screen.getByRole('button', { name: '완료 항목 정리' }));
  expect(screen.getByText('남은 작업이 없습니다.')).toBeVisible();
});
it('does not display another uploader instance files in an empty tab', async () => {
  const first = await mount();
  act(() => first.engine.add([new File(['data'], 'other-tab.pdf')], 'references', '', []));
  first.unmount();
  await mount();
  expect(screen.queryByRole('region', { name: '작업 진행 상황' })).not.toBeInTheDocument();
  expect(screen.queryByText('other-tab.pdf')).not.toBeInTheDocument();
  expect(first.engine.uppy.getFiles()).toHaveLength(1);
});
