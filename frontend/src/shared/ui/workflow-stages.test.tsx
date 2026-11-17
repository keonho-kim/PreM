// Purpose: Verify server-owned execution steps and non-color status cues in search/chat.
// Pattern: Read-only projections; progress estimates and focus changes are never inferred.
// Usage: Vitest; real server journeys cover checkpoints and revision behavior.
// Related: workflow-stages.tsx, related-documents, presentations/edit-proposal.tsx.
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { WorkflowStages } from './workflow-stages';
afterEach(cleanup);
it('distinguishes saved model work from failed rendering without moving focus', () => {
  render(
    <>
      <button type="button">원문 검토</button>
      <WorkflowStages
        name="수정안 준비 단계"
        status="failed"
        steps={[
          { key: 'propose', state: 'succeeded', attempt: 1 },
          { key: 'render', state: 'failed', attempt: 1 },
        ]}
        labels={{ propose: '수정안 작성', render: '미리보기 준비' }}
      />
    </>,
  );
  screen.getByRole('button').focus();
  expect(screen.getByRole('list')).toHaveTextContent('수정안 작성완료미리보기 준비확인 필요');
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  expect(screen.getByRole('button')).toHaveFocus();
});
it('shows cancellation for pending work and retains completed retrieval', () => {
  render(
    <WorkflowStages
      name="자료 찾기 단계"
      status="cancelled"
      steps={[
        { key: 'retrieve', state: 'succeeded', attempt: 0 },
        { key: 'review', state: 'pending', attempt: 1 },
      ]}
      labels={{ retrieve: '후보 찾기', review: '내용 비교·추가 확인' }}
    />,
  );
  expect(screen.getByRole('list')).toHaveTextContent('후보 찾기완료내용 비교·추가 확인중단');
});
