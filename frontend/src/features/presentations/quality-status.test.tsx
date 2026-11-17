// Purpose: Verify usable quality feedback without diagnostic leakage or disruptive focus changes.
// Pattern: Server outcomes exercise success, repair and blocked publication independently.
// Usage: Vitest with the existing DOM environment; no fabricated progress.
// Related: quality-status.tsx, quality-schema.ts, generation.tsx.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { QualityStatus } from './quality-status';
afterEach(cleanup);
test('announces checked slides and typography adjustments while retaining focus', () => {
  render(
    <>
      <button type="button">계속 작업</button>
      <QualityStatus
        rows={[
          {
            position: 1,
            reused: true,
            report: { schema_version: 1, passed: true, repair_attempts: 2, issues: [] },
          },
        ]}
      />
    </>,
  );
  screen.getByRole('button').focus();
  expect(screen.getByRole('status').textContent).toBe('1장 확인 완료 · 1장 글자 크기 조정');
  expect(document.activeElement).toBe(screen.getByRole('button'));
  expect(screen.queryByRole('progressbar')).toBeNull();
});
test('explains a failed slide and a deliberate overlap without exposing internal codes', () => {
  render(
    <QualityStatus
      rows={[
        {
          position: 2,
          reused: false,
          report: {
            schema_version: 1,
            passed: false,
            repair_attempts: 2,
            issues: [{ code: 'text_overflow', severity: 'error' }],
          },
        },
        {
          position: 3,
          reused: false,
          report: {
            schema_version: 1,
            passed: true,
            repair_attempts: 0,
            issues: [{ code: 'object_overlap', severity: 'warning' }],
          },
        },
      ]}
    />,
  );
  expect(screen.getByRole('status').textContent).toBe('1장 확인 완료 · 1장 확인 필요');
  expect(screen.getByText(/2번 장표/).textContent).toContain(
    '글자가 장표에 모두 들어가지 않습니다',
  );
  expect(screen.getByText(/3번 장표/).textContent).toContain('의도한 배치인지');
  expect(document.body.textContent).not.toContain('text_overflow');
});
