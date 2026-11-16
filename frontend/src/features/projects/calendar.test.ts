// Purpose: Guard calendar-day semantics across leap days and DST transitions.
// Pattern: Pure date-only inputs, independent of local timestamp duration.
// Usage: Vitest runs these alongside feature interaction tests.
// Related: calendar.ts, backend/tests/project_home.rs.
import { expect, it } from 'vitest';
import { deadline } from './calendar';
it('uses calendar days across DST boundaries and leap dates', () => {
  expect(deadline('2027-03-15', '2027-03-13').label).toBe('D-2');
  expect(deadline('2028-03-01', '2028-02-28').label).toBe('D-2');
  expect(deadline('2030-01-15', '2030-01-15').label).toBe('D-Day');
  expect(deadline('2030-01-15', '2030-01-16').label).toBe('D+1');
  expect(deadline(null, '2030-01-15').label).toBe('마감일 미정');
  expect(deadline('2030-02-30', '2030-01-15').label).toBe('마감일 미정');
});
