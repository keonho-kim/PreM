// Purpose: Verify source-material review, ordered multi-selection and error/cancellation behavior.
// Pattern: Real shadcn controls against a narrow, synthetic catalog API.
// Usage: Vitest; browser integration verifies actual PNGs and reference versions.
// Related: reference-materials.tsx, materials-api.ts, tests/e2e/reference-materials.cjs.
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReferenceMaterials } from './reference-materials';
import { getMaterials, resolveMaterials } from './materials-api';
vi.mock('./materials-api', async (original) => ({
  ...(await original<typeof import('./materials-api')>()),
  getMaterials: vi.fn(),
  resolveMaterials: vi.fn(),
}));
const job = 'f3920570-0367-46a1-9296-9a1329b9bce6';
const item = (number: number) => ({
  id: `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`,
  page_id: `page-${number}`,
  page_label: `슬라이드 ${number}`,
  source_page: number,
  kind: 'slide' as const,
  title: `장표 ${number}`,
  text: null,
  content_block_id: null,
  preview: 'a'.repeat(64),
  preview_scope: 'item' as const,
  native: {
    slide_part: `ppt/slides/slide${number}.xml`,
    shape_ids: [],
    image_part: null,
    image_asset: null,
  },
});
const data = {
  schema_version: 1 as const,
  reference_id: job,
  job_id: job,
  file_version: 2,
  source_sha256: 'b'.repeat(64),
  extraction_id: job,
  bundle: 'c'.repeat(64),
  ready: true,
  total: 2,
  items: [item(1), item(2)],
};
const clients: QueryClient[] = [];
function mount(groupSlides = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <ReferenceMaterials job={job} groupSlides={groupSlides} />
    </QueryClientProvider>,
  );
}
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((c) => {
    c.clear();
  });
  vi.resetAllMocks();
});
it('resolves multiple slides in selection order without claiming PPT insertion', async () => {
  vi.mocked(getMaterials).mockResolvedValue(data);
  vi.mocked(resolveMaterials).mockResolvedValue({ ...data, items: [item(2), item(1)] });
  const user = userEvent.setup();
  mount();
  await user.click(await screen.findByRole('button', { name: '슬라이드 2 장표 2 선택' }));
  await user.click(screen.getByRole('button', { name: '슬라이드 1 장표 1 선택' }));
  await user.click(screen.getByRole('button', { name: '선택한 자료 보기' }));
  await screen.findByText('선택한 자료 2개');
  expect(vi.mocked(resolveMaterials).mock.calls[0]?.slice(0, 2)).toEqual([
    job,
    [item(2).id, item(1).id],
  ]);
  expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
    '장표 2',
    '장표 1',
  ]);
  expect(screen.queryByRole('button', { name: /PPT에 삽입|생성/ })).not.toBeInTheDocument();
  expect(screen.getAllByRole('img')[0]).toHaveAttribute('loading', 'lazy');
  await user.click(screen.getByRole('button', { name: '전체 자료로 돌아가기' }));
  expect(screen.getByRole('button', { name: '슬라이드 2 장표 2 선택' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});
it('preserves selected IDs after resolution fails and aborts an unfinished review on exit', async () => {
  vi.mocked(getMaterials).mockResolvedValue(data);
  vi.mocked(resolveMaterials).mockRejectedValueOnce(new Error('offline'));
  const user = userEvent.setup();
  const view = mount();
  await user.click(await screen.findByRole('button', { name: '슬라이드 1 장표 1 선택' }));
  await user.click(screen.getByRole('button', { name: '선택한 자료 보기' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('button', { name: '슬라이드 1 장표 1 선택' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  vi.mocked(resolveMaterials).mockImplementation(() => new Promise(() => {}));
  await user.click(screen.getByRole('button', { name: '선택한 자료 보기' }));
  await waitFor(() => expect(resolveMaterials).toHaveBeenCalledTimes(2));
  const signal = vi.mocked(resolveMaterials).mock.calls[1]?.[2];
  view.unmount();
  expect(signal?.aborted).toBe(true);
});
it('explains legacy preparation instead of fabricating reusable parts', async () => {
  vi.mocked(getMaterials).mockResolvedValue({ ...data, ready: false, total: 0, items: [] });
  mount();
  await screen.findByText(/아직 재사용 자료가 준비되지 않았습니다/);
  expect(screen.queryAllByRole('img')).toHaveLength(0);
  expect(screen.getByRole('button', { name: '선택한 자료 보기' })).toBeDisabled();
});

it('joins later results to the same source slide without mixing different slides', async () => {
  const first = item(1);
  const diagram = { ...first, id: 'diagram', kind: 'diagram' as const, title: '도식' };
  vi.mocked(getMaterials)
    .mockResolvedValueOnce({ ...data, total: 3, items: [first] })
    .mockResolvedValueOnce({ ...data, total: 3, items: [diagram, item(2)] });
  mount(true);
  await userEvent.click(await screen.findByRole('button', { name: '자료 더 보기' }));
  const heading = await screen.findByRole('heading', { name: '슬라이드 2' });
  expect(screen.getAllByRole('heading', { name: '슬라이드 1' })).toHaveLength(1);
  expect(screen.getByRole('heading', { name: '슬라이드 1' }).closest('section')).toHaveTextContent(
    '도식',
  );
  expect(heading.closest('section')).not.toHaveTextContent('도식');
  expect(screen.queryByRole('button', { name: '자료 더 보기' })).toBeNull();
});
