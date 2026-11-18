// Purpose: Verify source-purpose branching, truthful progress and conditional processing commands.
// Pattern: Real shadcn views with Query-owned fixture responses and explicit API mocks.
// Usage: Vitest; server/browser suites cover actual tools, shared writes and persistence.
// Related: processing-dialog.tsx, status.tsx, backend/tests/document_processing.rs.
import { renderRouted as render } from '@/test/render-routed';
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterTestHarness } from '@/test/router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProcessingDialog } from './processing-dialog';
import { ProcessingStatus } from './status';
import { command, getDetail, getBlocks, type Detail } from './api';
import { ApiError } from '@/shared/api/http';
vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  command: vi.fn(),
  getDetail: vi.fn(),
  getBlocks: vi.fn(),
}));
const id = 'f3920570-0367-46a1-9296-9a1329b9bce6';
const job = {
  id,
  kind: 'references' as const,
  item_id: id,
  file_version: 1,
  status: 'succeeded' as const,
  version: 4,
  attempt: 1,
  extraction_id: id,
  config_id: id,
  error_code: null,
  created_at: 1,
  updated_at: 2,
  total_blocks: 2,
  completed_blocks: 2,
};
const detail: Detail = {
  reuse_ready: true,
  job,
  pages: [],
  page_mode: 'unpaginated',
  warnings: [],
  template: null,
  template_extractable: true,
  template_bundle: null,
};
const clients: QueryClient[] = [];
async function mount(data: Detail) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  vi.mocked(getDetail).mockResolvedValue(data);
  vi.mocked(getBlocks).mockResolvedValue([]);
  await render(
    <RouterTestHarness basepath="/home" initialEntries={['/home/space']}>
      <QueryClientProvider client={client}>
        <ProcessingDialog
          item={{ id, kind: data.job.kind, title: '검증 자료', version: 1, file_version: 1 }}
          onClose={vi.fn()}
        />
      </QueryClientProvider>
    </RouterTestHarness>,
  );
}
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((c) => {
    c.clear();
  });
  vi.resetAllMocks();
});
it('shows reference content without internal classification diagnostics', async () => {
  await mount(detail);
  await screen.findByRole('tab', { name: '내용' });
  expect(screen.queryByText(/판정|체크포인트|템플릿 추출 가능/)).not.toBeInTheDocument();
});
it('previews template slides and never displays structure or queries document blocks', async () => {
  await mount({
    ...detail,
    job: { ...job, kind: 'templates', extraction_id: null, config_id: null },
    template_extractable: false,
    template: {
      schema_version: 1,
      manifest: { masters: [{}], layouts: [{ name: 'Title' }], slides: [{}, {}] },
      native_structure: {},
      previews: [1, 2].map((ordinal) => ({
        ordinal,
        width: 1440,
        height: 810,
        sha256: String(ordinal).repeat(64),
      })),
    },
    template_bundle: 'a'.repeat(64),
  });
  const image = await screen.findByRole('img', { name: '슬라이드 1 미리보기' });
  expect(image).toHaveAttribute('loading', 'eager');
  expect(image).toHaveAttribute('fetchpriority', 'high');
  expect(screen.queryByText(/네이티브|번들|PPT Master|체크포인트/)).not.toBeInTheDocument();
  expect(getBlocks).not.toHaveBeenCalled();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: '다음 슬라이드' }));
  expect(await screen.findByRole('img', { name: '슬라이드 2 미리보기' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '슬라이드 2 보기' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(screen.getByRole('button', { name: '다음 슬라이드' })).toBeDisabled();
});
it('uses observed block counts only and does not fabricate extraction percentages', async () => {
  const view = await render(<ProcessingStatus job={{ ...job, status: 'extracting' }} />);
  expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
  view.rerender(<ProcessingStatus job={{ ...job, status: 'classifying', completed_blocks: 1 }} />);
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
});
it('preserves the conditional cancel target and displays conflicts without automatic retries', async () => {
  await mount({ ...detail, job: { ...job, status: 'classifying', completed_blocks: 0 } });
  vi.mocked(command).mockRejectedValue(
    new ApiError(409, 'revision_conflict', '다른 작업이 상태를 변경했습니다.'),
  );
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: '취소' }));
  await screen.findByRole('alert');
  await waitFor(() => expect(command).toHaveBeenCalledOnce());
  expect(vi.mocked(command).mock.calls[0]?.[0].version).toBe(4);
  expect(vi.mocked(command).mock.calls[0]?.[1]).toBe('cancel');
});

it('keeps configuration details out of shared asset previews', async () => {
  await mount({ ...detail, job: { ...job, status: 'waiting_configuration' } });
  await screen.findByText('자료 준비가 잠시 대기 중입니다');
  expect(screen.queryByRole('link', { name: /Admin/ })).not.toBeInTheDocument();
});
