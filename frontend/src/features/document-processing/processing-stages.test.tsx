// Purpose: Verify truthful engine stages, measured classification progress and explicit recovery actions.
// Pattern: Real shadcn components and Query mutations; simulated transport only in test fixtures.
// Usage: Vitest; server/browser suites cover persistence, cancellation fencing and shared views.
// Related: status.tsx, upload-processing.tsx, document_workflows.rs.
import '@testing-library/jest-dom/vitest';
import { it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProcessingStatus } from './status';
import { UploadProcessing } from './upload-processing';
import { getDetail, command, type Job, type Detail } from './api';
vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  getDetail: vi.fn(),
  command: vi.fn(),
}));
const job: Job = {
  id: 'job',
  kind: 'references',
  item_id: 'item',
  file_version: 1,
  status: 'waiting_configuration',
  version: 3,
  attempt: 1,
  extraction_id: 'extraction',
  config_id: null,
  error_code: null,
  created_at: 0,
  updated_at: 0,
  total_blocks: 40,
  completed_blocks: 0,
  steps: [
    { key: 'extract', state: 'succeeded', attempt: 1 },
    { key: 'classify', state: 'pending', attempt: 1 },
    { key: 'ready', state: 'pending', attempt: 0 },
  ],
};
let client: QueryClient | undefined;
afterEach(() => {
  cleanup();
  client?.clear();
  client = undefined;
  vi.clearAllMocks();
});
it('shows extracted content waiting for configuration without inventing completion progress', () => {
  render(<ProcessingStatus job={job} />);
  expect(screen.getByLabelText('자료 준비 단계')).toBeVisible();
  expect(screen.getByText('문서 읽기').closest('li')).toHaveTextContent('완료');
  expect(screen.getByText('내용 정리').closest('li')).toHaveTextContent('설정 대기');
  expect(screen.getByText('검색·작성 준비').closest('li')).toHaveTextContent('대기');
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
});
it('limits progress percentage to measured block decisions and keeps template stages separate', () => {
  const { rerender } = render(
    <ProcessingStatus
      job={{
        ...job,
        status: 'classifying',
        completed_blocks: 16,
        steps: job.steps?.map((s) => (s.key === 'classify' ? { ...s, state: 'running' } : s)),
      }}
    />,
  );
  expect(screen.getByRole('progressbar', { name: '내용 정리 진행률' })).toHaveAttribute(
    'aria-valuenow',
    '40',
  );
  expect(screen.getByText('내용 정리').closest('li')).toHaveAttribute('aria-current', 'step');
  rerender(
    <ProcessingStatus
      job={{
        ...job,
        kind: 'templates',
        status: 'succeeded',
        steps: [
          { key: 'extract', state: 'succeeded', attempt: 1 },
          { key: 'ready', state: 'succeeded', attempt: 1 },
        ],
      }}
    />,
  );
  expect(screen.queryByText('내용 정리')).not.toBeInTheDocument();
  expect(screen.getByText('템플릿 미리보기 준비')).toBeVisible();
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
});
it('cancels preparation explicitly and reuses the retry receipt after a network failure', async () => {
  let detail: Detail = {
    job,
    pages: [],
    page_mode: 'section',
    warnings: [],
    reuse_ready: true,
    template: null,
    template_extractable: false,
    template_bundle: null,
  };
  vi.mocked(getDetail).mockImplementation(async () => detail);
  vi.mocked(command).mockImplementation(async (j, action) => {
    detail = {
      ...detail,
      job: { ...j, status: action === 'cancel' ? 'cancelled' : 'queued', version: j.version + 1 },
    };
    return detail.job;
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <UploadProcessing kind="references" id="item" />
    </QueryClientProvider>,
  );
  await userEvent.click(await screen.findByRole('button', { name: '자료 준비 취소' }));
  await waitFor(() => expect(command).toHaveBeenCalledTimes(1));
  expect(vi.mocked(command).mock.calls[0]?.[1]).toBe('cancel');
  await screen.findByRole('button', { name: '자료 준비 다시 시도' });
  vi.mocked(command).mockRejectedValueOnce(Error('network failure'));
  await userEvent.click(screen.getByRole('button', { name: '자료 준비 다시 시도' }));
  await screen.findByRole('alert');
  const receipt = vi.mocked(command).mock.calls[1]?.[2];
  await userEvent.click(screen.getByRole('button', { name: '자료 준비 다시 시도' }));
  await waitFor(() => expect(command).toHaveBeenCalledTimes(3));
  expect(vi.mocked(command).mock.calls[2]?.[2]).toBe(receipt);
  expect(receipt).toBeTruthy();
});
