// Purpose: Verify project forms use the API safely and retain drafts after conflicts.
// Pattern: Real feature UI with an isolated Query client and controlled HTTP responses.
// Usage: pnpm --filter @puputyx/frontend test.
// Related: project-dialog.tsx, api.ts, pages/projects-page.tsx.
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { screen, within } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { defaultFilters } from './api';
import { ProjectDirectory } from './project-directory';
import type { InternalAxiosRequestConfig } from 'axios';
const transport = vi.hoisted(() => vi.fn());
vi.mock('axios', async (importOriginal) => {
  const { default: axios } = await importOriginal<typeof import('axios')>();
  return {
    default: {
      create: (options: Parameters<typeof axios.create>[0]) =>
        axios.create({ ...options, adapter: transport }),
    },
  };
});
const response = (data: unknown, status = 200) => ({ data, status });

const client = new QueryClient({
  defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
});
function mount() {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ProjectDirectory
          filters={defaultFilters}
          offset={0}
          onFilter={() => {}}
          onPage={() => {}}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
afterEach(() => {
  cleanup();
  client.clear();
  vi.unstubAllGlobals();
  transport.mockReset();
});
const base = {
  id: 'd5c904db-e506-4d27-a1d0-481ad457af20',
  name: '공유 프로젝트',
  due_date: '2030-01-31',
  status: 'active',
  deleted_at: null,
  version: 1,
  created_at: 1700000000000,
  updated_at: 1700000000000,
};

it('retains the same creation key after an uncertain network failure', async () => {
  const keys: string[] = [];
  let saved = false;
  transport.mockImplementation(async (init: InternalAxiosRequestConfig) => {
    if (init.method === 'post') {
      keys.push(String(init.headers.get('Idempotency-Key') ?? ''));
      if (!saved) {
        saved = true;
        throw new TypeError('connection lost after commit');
      }
      return response(base);
    }
    return response({
      items: saved ? [base] : [],
      total: saved ? 1 : 0,
      offset: 0,
      limit: 20,
    });
  });
  const user = userEvent.setup();
  mount();
  await user.click(screen.getByRole('button', { name: '프로젝트 만들기' }));
  const dialog = within(screen.getByRole('dialog'));
  await user.type(dialog.getByRole('textbox', { name: '프로젝트 이름' }), base.name);
  await user.type(dialog.getByLabelText('마감일'), '2030-01-31');
  await user.click(dialog.getByRole('button', { name: '프로젝트 만들기' }));
  await waitFor(() =>
    expect(dialog.getByRole('status')).toHaveTextContent('입력한 내용은 유지됩니다'),
  );
  expect(dialog.getByRole('textbox', { name: '프로젝트 이름' })).toHaveValue(base.name);
  await user.click(dialog.getByRole('button', { name: '프로젝트 만들기' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(keys).toHaveLength(2);
  expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
  expect(keys[0]).toBe(keys[1]);
});

it('requires explicit latest-revision review while preserving a rename draft', async () => {
  const versions: number[] = [];
  transport.mockImplementation(async (init: InternalAxiosRequestConfig) => {
    if (init.method === 'patch') {
      versions.push(JSON.parse(String(init.data)).expected_version);
      return versions.length === 1
        ? response({ code: 'revision_conflict', message: '다른 접속자가 변경했습니다.' }, 409)
        : response({ ...base, name: '내가 입력한 이름', version: 3 });
    }
    if (init.url === `/api/v1/projects/${base.id}`)
      return response({ ...base, name: '다른 사람이 저장한 이름', version: 2 });
    return response({ items: [base], total: 1, offset: 0, limit: 20 });
  });
  const user = userEvent.setup();
  mount();
  await user.click(await screen.findByRole('button', { name: '공유 프로젝트 메뉴' }));
  await user.click(await screen.findByRole('menuitem', { name: '이름 바꾸기' }));
  const dialog = within(screen.getByRole('dialog'));
  const input = dialog.getByRole('textbox', { name: '프로젝트 이름' });
  await user.clear(input);
  await user.type(input, '내가 입력한 이름');
  await user.click(dialog.getByRole('button', { name: '저장' }));
  await user.click(await dialog.findByRole('button', { name: '최신 이름 확인' }));
  await waitFor(() =>
    expect(dialog.getByRole('status')).toHaveTextContent('다른 사람이 저장한 이름'),
  );
  expect(input).toHaveValue('내가 입력한 이름');
  await user.click(dialog.getByRole('button', { name: '저장' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(versions).toEqual([1, 2]);
});

it('keeps the draft and dialog open while a save is unresolved', async () => {
  let complete: (value: ReturnType<typeof response>) => void = () => {};
  transport.mockImplementation(async (init: InternalAxiosRequestConfig) => {
    if (init.method === 'post')
      return new Promise<ReturnType<typeof response>>((resolve) => {
        complete = resolve;
      });
    return response({ items: [], total: 0, offset: 0, limit: 6 });
  });
  const user = userEvent.setup();
  mount();
  await user.click(screen.getByRole('button', { name: '프로젝트 만들기' }));
  const dialog = within(screen.getByRole('dialog', { name: '새 프로젝트' }));
  await user.type(dialog.getByLabelText('프로젝트 이름'), base.name);
  await user.type(dialog.getByLabelText('마감일'), base.due_date);
  await user.click(dialog.getByRole('button', { name: '프로젝트 만들기' }));
  try {
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: '새 프로젝트' })).toBeInTheDocument();
    expect(dialog.getByLabelText('프로젝트 이름')).toHaveValue(base.name);
    expect(dialog.getByRole('button', { name: '취소' })).toBeDisabled();
  } finally {
    complete(response(base));
  }
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});
