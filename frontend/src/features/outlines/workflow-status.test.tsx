// Purpose: Verify saved outline steps, bounded progress and completion focus behavior.
// Pattern: Server projections drive UI; no inferred total-time percentage or engine terms.
// Usage: Vitest/Testing Library; browser journeys cover persisted restart and shared revisions.
// Related: workflow-status.tsx, generation.tsx, backend/tests/outline_workflows.rs.
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { WorkflowStatus } from './workflow-status';
import type { Run } from './api';
afterEach(cleanup);
const run: Run = {
  id: 'run',
  project_id: 'project',
  kind: 'map',
  status: 'running',
  version: 2,
  total: 3,
  completed: 1,
  included_blocks: 22,
  total_blocks: 22,
  error_code: null,
  result_revision_id: null,
  steps: [
    { key: 'map', state: 'running', attempt: 2 },
    { key: 'publish', state: 'pending', attempt: 0 },
  ],
};
it('shows measured mapping batches and saved current stage without moving focus', () => {
  render(
    <>
      <button type="button">원문 검토</button>
      <WorkflowStatus run={run} />
    </>,
  );
  screen.getByRole('button').focus();
  expect(screen.getByRole('list', { name: '목차·내용 처리 단계' })).toHaveTextContent(
    '내용 연결진행 중결과 저장대기',
  );
  expect(
    Number(
      screen.getByRole('progressbar', { name: '내용 연결 진행률' }).getAttribute('aria-valuenow'),
    ),
  ).toBeCloseTo(100 / 3);
  expect(screen.getByRole('listitem', { current: 'step' })).toHaveTextContent('내용 연결');
  expect(screen.getByRole('button')).toHaveFocus();
});
it('does not report overall completion when all model batches are saved but publication fails', () => {
  render(
    <WorkflowStatus
      run={{
        ...run,
        status: 'failed',
        completed: 3,
        steps: [
          { key: 'map', state: 'succeeded', attempt: 1 },
          { key: 'publish', state: 'failed', attempt: 1 },
        ],
      }}
    />,
  );
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  expect(screen.getByRole('list')).toHaveTextContent('내용 연결완료결과 저장확인 필요');
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
it('keeps completed composition visible and announces success without forcing focus', () => {
  const props = {
    ...run,
    kind: 'generate' as const,
    status: 'succeeded' as const,
    steps: [
      { key: 'compose', state: 'succeeded', attempt: 1 },
      { key: 'publish', state: 'succeeded', attempt: 1 },
    ],
  };
  const view = render(
    <>
      <button type="button">검토</button>
      <WorkflowStatus run={run} />
    </>,
  );
  screen.getByRole('button').focus();
  view.rerender(
    <>
      <button type="button">검토</button>
      <WorkflowStatus run={props} />
    </>,
  );
  expect(screen.getByRole('status')).toHaveTextContent('자동 구성을 마쳤습니다');
  expect(screen.getByRole('list')).toHaveTextContent('목차 구성완료결과 저장완료');
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  expect(screen.getByRole('button')).toHaveFocus();
});
