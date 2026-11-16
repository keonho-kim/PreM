// Purpose: Verify native discovery precedes model selection without exposing retained credentials.
// Pattern: Real shadcn fields with API boundaries; stale discovery and conflicts preserve drafts.
// Usage: Vitest; real native transport and persistence are covered by HTTP/browser suites.
// Related: provider-form.tsx, use-model-discovery.ts, tests/e2e/providers.cjs.
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { catalogFixture } from './test-fixtures';
import { ProviderForm } from './provider-form';
import { discoverModels, saveProvider, getProvider, type Provider } from './api';
import { ApiError } from '@/shared/api/http';
vi.mock('./api', () => ({ saveProvider: vi.fn(), getProvider: vi.fn(), discoverModels: vi.fn() }));
beforeAll(() => {
  HTMLElement.prototype.hasPointerCapture = () => false;
  HTMLElement.prototype.setPointerCapture = () => {};
  HTMLElement.prototype.releasePointerCapture = () => {};
  HTMLElement.prototype.scrollIntoView = () => {};
});
const clients: QueryClient[] = [];
const provider: Provider = {
  id: 'f3920570-0367-46a1-9296-9a1329b9bce6',
  config_id: 'a63c8ae7-b705-454b-8c5a-4374a306ab15',
  version: 1,
  name: 'LM Studio',
  provider_type: 'lm_studio_native',
  base_url: 'http://127.0.0.1:1234/api/v1/',
  model_identifier: 'saved-model',
  timeout_seconds: 180,
  enabled: true,
  has_secret: true,
  created_at: 1,
};
function mount(value: Provider | null) {
  const client = new QueryClient();
  clients.push(client);
  const onSaved = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <ProviderForm catalog={catalogFixture} provider={value} onSaved={onSaved} />
    </QueryClientProvider>,
  );
  return onSaved;
}
const choose = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
  await user.click(screen.getByRole('combobox', { name: '사용할 모델 · 필수' }));
  await user.click(screen.getByRole('option', { name }));
};
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((c) => {
    c.clear();
  });
  vi.resetAllMocks();
});
it('requires actual discovery and selection before registering a model', async () => {
  const user = userEvent.setup();
  mount(null);
  await user.click(screen.getByRole('button', { name: '설정 저장' }));
  expect(saveProvider).not.toHaveBeenCalled();
  vi.mocked(discoverModels).mockResolvedValue(['available-model']);
  await user.click(screen.getByRole('button', { name: '모델 목록 조회' }));
  await screen.findByText('1개 모델을 찾았습니다. 사용할 모델을 선택하세요.');
  expect(saveProvider).not.toHaveBeenCalled();
  await choose(user, 'available-model');
  vi.mocked(saveProvider).mockResolvedValue(provider);
  await user.click(screen.getByRole('button', { name: '설정 저장' }));
  await waitFor(() => expect(saveProvider).toHaveBeenCalledOnce());
  expect(vi.mocked(saveProvider).mock.calls[0]?.[2].model_identifier).toBe('available-model');
});
it('keeps retained credentials hidden, confirms changes and reviews conflicts', async () => {
  const user = userEvent.setup();
  const saved = mount(provider);
  expect(screen.getByLabelText('새 연결 주소')).toHaveValue('');
  expect(screen.getByLabelText('새 API Key')).toHaveValue('');
  vi.mocked(discoverModels).mockResolvedValue(['new-model']);
  await user.click(screen.getByRole('button', { name: '모델 목록 조회' }));
  await screen.findByText('1개 모델을 찾았습니다. 사용할 모델을 선택하세요.');
  expect(vi.mocked(discoverModels).mock.calls[0]?.[0]).toMatchObject({
    connection_id: provider.id,
    expected_version: 1,
    base_url: undefined,
    api_key: undefined,
  });
  await choose(user, 'new-model');
  vi.mocked(saveProvider)
    .mockRejectedValueOnce(new ApiError(409, 'revision_conflict', '최신 설정을 확인하세요.'))
    .mockResolvedValueOnce({ ...provider, version: 3 });
  vi.mocked(getProvider).mockResolvedValue({ ...provider, version: 2 });
  await user.click(screen.getByRole('button', { name: '변경 사항 저장' }));
  expect(saveProvider).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '돌아가기' })).toHaveFocus();
  await user.click(screen.getByRole('button', { name: '돌아가기' }));
  expect(screen.getByRole('combobox', { name: '사용할 모델 · 필수' })).toHaveTextContent(
    'new-model',
  );
  await user.click(screen.getByRole('button', { name: '변경 사항 저장' }));
  await user.click(screen.getByRole('button', { name: '확인하고 저장' }));
  await user.click(await screen.findByRole('button', { name: '최신 설정 확인' }));
  await waitFor(() => expect(screen.getByText(/최신 v2/)).toBeInTheDocument());
  await user.click(screen.getByRole('button', { name: '모델 목록 조회' }));
  await screen.findByText('1개 모델을 찾았습니다. 사용할 모델을 선택하세요.');
  await user.click(screen.getByRole('button', { name: '변경 사항 저장' }));
  await user.click(screen.getByRole('button', { name: '확인하고 저장' }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(vi.mocked(saveProvider).mock.calls[1]?.[1]).toBe(2);
});
it('invalidates discovered choices when endpoint changes and ignores a late response', async () => {
  const user = userEvent.setup();
  mount(null);
  let finish!: (models: string[]) => void;
  vi.mocked(discoverModels).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await user.click(screen.getByRole('button', { name: '모델 목록 조회' }));
  const signal = vi.mocked(discoverModels).mock.calls[0]?.[1];
  await user.type(screen.getByLabelText('연결 주소 · 필수'), '/changed');
  expect(signal?.aborted).toBe(true);
  finish(['obsolete-model']);
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: '사용할 모델 · 필수' })).toBeDisabled(),
  );
  expect(screen.queryByText('obsolete-model')).not.toBeInTheDocument();
  expect(saveProvider).not.toHaveBeenCalled();
});
it('preserves input after failure and supports empty results, cancellation and retry', async () => {
  const user = userEvent.setup();
  mount(null);
  vi.mocked(discoverModels)
    .mockRejectedValueOnce(new Error('unavailable'))
    .mockResolvedValueOnce([]);
  await user.click(screen.getByRole('button', { name: '모델 목록 조회' }));
  await screen.findByText(/입력한 내용은 유지됩니다/);
  await user.click(screen.getByRole('button', { name: '모델 목록 조회' }));
  await screen.findByText(/선택할 모델이 없습니다/);
  vi.mocked(discoverModels).mockImplementation(() => new Promise(() => {}));
  await user.click(screen.getByRole('button', { name: '모델 목록 조회' }));
  await user.click(screen.getByRole('button', { name: '조회 취소' }));
  expect(vi.mocked(discoverModels).mock.calls[2]?.[1].aborted).toBe(true);
  expect(screen.getByText(/조회를 취소했습니다/)).toBeInTheDocument();
});
it('requires re-discovery after replacing a key and never repeats the key in confirmation', async () => {
  const user = userEvent.setup();
  mount(provider);
  await user.type(screen.getByLabelText('새 API Key'), 'new-key');
  await user.click(screen.getByRole('button', { name: '변경 사항 저장' }));
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  vi.mocked(discoverModels).mockResolvedValue(['saved-model']);
  await user.click(screen.getByRole('button', { name: '모델 목록 조회' }));
  await screen.findByText('1개 모델을 찾았습니다. 사용할 모델을 선택하세요.');
  await user.click(screen.getByRole('button', { name: '변경 사항 저장' }));
  expect(screen.getByRole('alertdialog')).not.toHaveTextContent('new-key');
  expect(vi.mocked(discoverModels).mock.calls[0]?.[0].api_key).toBe('new-key');
});
