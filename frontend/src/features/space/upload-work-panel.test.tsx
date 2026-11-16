// Purpose: Verify user-invoked notifications and tab-local queue presentation.
// Pattern: Real Uppy state with transmission disabled; public UI behavior through shadcn.
// Usage: Vitest; cross-browser isolation and route continuity are covered by Space E2E.
// Related: upload-work-panel.tsx, upload-engine.ts, tests/e2e/space.cjs.
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { createUploadEngine } from './upload-engine';
import { useUploadEngine } from './use-upload-engine';
import { UploadWorkPanel } from './upload-work-panel';
import { useWorkPanelState } from '@/shared/work-panel-state';
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
function mount() {
  const engine = createUploadEngine(vi.fn());
  engine.uppy.setOptions({ autoProceed: false });
  engines.push(engine);
  vi.mocked(useUploadEngine).mockReturnValue(engine);
  const view = render(
    <MemoryRouter>
      <UploadWorkPanel />
    </MemoryRouter>,
  );
  return { engine, ...view };
}
afterEach(() => {
  cleanup();
  useWorkPanelState.setState(useWorkPanelState.getInitialState(), true);
  engines.splice(0).forEach((engine) => {
    engine.dispose();
  });
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
it('keeps the work queue alive through collapse, close, reopen and completion', async () => {
  const user = userEvent.setup();
  const { engine } = mount();
  expect(screen.queryByRole('region', { name: '작업 진행 상황' })).not.toBeInTheDocument();
  act(() => engine.add([new File(['data'], 'own.pdf')], 'references', '', []));
  expect(screen.getByText('own.pdf')).toBeVisible();
  const collapse = screen.getByRole('button', { name: '작업 패널 접기' });
  await user.click(collapse);
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
  act(() =>
    engine.uppy.setFileState(file.id, {
      progress: { ...file.progress, uploadComplete: true, percentage: 100 },
    }),
  );
  expect(screen.getByRole('heading', { name: '업로드 완료' })).toBeVisible();
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '완료 항목 정리' }));
  expect(screen.queryByRole('region', { name: '작업 진행 상황' })).not.toBeInTheDocument();
});
it('does not display another uploader instance files in an empty tab', async () => {
  const first = mount();
  act(() => first.engine.add([new File(['data'], 'other-tab.pdf')], 'references', '', []));
  first.unmount();
  mount();
  expect(screen.queryByRole('region', { name: '작업 진행 상황' })).not.toBeInTheDocument();
  expect(screen.queryByText('other-tab.pdf')).not.toBeInTheDocument();
  expect(first.engine.uppy.getFiles()).toHaveLength(1);
});
