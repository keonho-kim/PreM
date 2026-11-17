// Purpose: Verify preview-first source selection inside the slide editor without accidental mutation.
// Pattern: Real shadcn dialog/select with mocked canonical catalogs; no application storage.
// Usage: Vitest; native browser tests validate actual rendering, replay and revision commits.
// Related: material-insertion.tsx, presentation_references.rs.
import '@testing-library/jest-dom/vitest';
import { afterAll, beforeAll, afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MaterialInsertion } from './material-insertion';
import { request } from '@/shared/api/http';
import type { Run } from './api';
vi.mock('@/shared/api/http', async (original) => ({
  ...(await original<typeof import('@/shared/api/http')>()),
  request: vi.fn(),
}));
const { readFiles, readDetail, readMaterials } = vi.hoisted(() => ({
  readFiles: vi.fn(),
  readDetail: vi.fn(),
  readMaterials: vi.fn(),
}));
vi.mock('@/features/space', () => ({ listAssets: readFiles }));
vi.mock('@/features/document-processing', () => ({
  getDetail: readDetail,
  getMaterials: readMaterials,
  fileUrl: (job: string, hash: string) => `/preview/${job}/${hash}`,
}));
const platformMethods = [
  'hasPointerCapture',
  'setPointerCapture',
  'releasePointerCapture',
  'scrollIntoView',
] as const;
const originalMethods = platformMethods.map(
  (name) => [name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)] as const,
);
beforeAll(() => {
  for (const name of platformMethods)
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      value: name === 'hasPointerCapture' ? () => false : () => {},
    });
});
afterAll(() => {
  for (const [name, descriptor] of originalMethods) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
    else delete HTMLElement.prototype[name];
  }
});
let client: QueryClient;
afterEach(() => {
  cleanup();
  client?.clear();
  vi.clearAllMocks();
});
it('does not fetch while closed and returns only explicitly selected immutable material IDs', async () => {
  readFiles.mockResolvedValue({
    items: [{ id: 'reference', title: '분기 보고서', filename: 'quarter.pptx' }],
    total: 1,
  });
  readDetail.mockResolvedValue({ job: { id: 'pinned-job' } });
  readMaterials.mockResolvedValue({
    total: 2,
    items: [
      {
        id: 'chart',
        title: '분기 매출',
        kind: 'chart',
        page_label: '슬라이드 1',
        preview: 'chart-hash',
        preview_scope: 'item',
      },
      {
        id: 'slide',
        title: '요약 장표',
        kind: 'slide',
        page_label: '슬라이드 2',
        preview: 'slide-hash',
        preview_scope: 'item',
      },
    ],
  });
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const choose = vi.fn(),
    user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <MaterialInsertion
        project="project"
        run={{ id: 'run', presentation_version: 3 } as Run}
        slide="slide"
        editable
        onResult={choose}
      />
    </QueryClientProvider>,
  );
  vi.mocked(request).mockResolvedValue({ id: 'updated-run' });
  expect(readFiles).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: '레퍼런스 넣기' }));
  await waitFor(() => expect(readFiles).toHaveBeenCalled());
  await user.click(screen.getByRole('combobox', { name: '레퍼런스 파일' }));
  await user.click(await screen.findByRole('option', { name: '분기 보고서 · quarter.pptx' }));
  await screen.findByRole('button', { name: '분기 매출 크게 보기' });
  await user.click(screen.getByRole('button', { name: '분기 매출 크게 보기' }));
  expect(choose).not.toHaveBeenCalled();
  const [choice] = screen.getAllByRole('button', { name: /^선택$/ });
  if (!choice) throw Error('Expected a visible material selection control');
  await user.click(choice);
  await user.click(screen.getByRole('button', { name: '선택한 자료 1개 넣기' }));
  await waitFor(() => expect(choose).toHaveBeenCalledWith('updated-run'));
  expect(JSON.parse(vi.mocked(request).mock.calls.at(0)?.[2]?.body as string)).toEqual({
    expected_version: 3,
    slide_id: 'slide',
    items: [{ job_id: 'pinned-job', material_id: 'chart' }],
  });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
