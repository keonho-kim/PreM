// Purpose: Verify real stage states are shown without developer node IDs or invented progress.
// Pattern: Accessible ordered checkpoints from the canonical run projection.
// Usage: Vitest; generation API transport and recovery have separate integration tests.
// Related: workflow-status.tsx, backend/tests/presentation_workflows.rs.
import '@testing-library/jest-dom/vitest';
import { it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WorkflowStatus } from './workflow-status';
import type { Run } from './api';
it('shows a completed write and active file check without fabricating a percentage', () => {
  const run: Run = {
    id: 'r',
    project_id: 'p',
    presentation_id: 'd',
    presentation_version: 0,
    is_current: false,
    title: 'test',
    status: 'running',
    stage: 'rendering',
    version: 2,
    completed: 2,
    total: 2,
    error_code: null,
    created_at: 0,
    steps: [
      { key: 'write', state: 'succeeded', attempt: 1 },
      { key: 'render', state: 'running', attempt: 1 },
      { key: 'publish', state: 'pending', attempt: 0 },
    ],
  };
  render(<WorkflowStatus run={run} />);
  expect(screen.getByLabelText('발표자료 처리 단계')).toBeVisible();
  expect(screen.getByText('파일 생성·검사').closest('li')).toHaveAttribute('aria-current', 'step');
  expect(screen.getByText('완료')).toBeVisible();
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
});
