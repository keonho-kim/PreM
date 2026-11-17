// Purpose: Verify the Home deadline filter supports text entry and calendar selection.
// Pattern: Exercise the filter through its labeled controls and submitted values.
// Usage: pnpm --filter @prem/frontend test src/features/projects/project-filters.test.tsx.
// Related: project-filters.tsx, due-date-picker.tsx.
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { defaultFilters } from './api';
import { ProjectFilterForm } from './project-filters';

afterEach(cleanup);

it('opens the filter calendar on click while keeping the date editable', async () => {
  const onChange = vi.fn();
  const user = userEvent.setup();
  render(<ProjectFilterForm filters={defaultFilters} onChange={onChange} />);
  const input = screen.getByRole('combobox', { name: '마감일' });
  expect(screen.queryByRole('button', { name: '마감일 달력 열기' })).not.toBeInTheDocument();

  await user.click(input);
  const calendar = await screen.findByRole('dialog', { name: '마감일 달력' });
  expect(input).toHaveFocus();
  await user.keyboard('2030-01-15');
  expect(input).toHaveValue('2030-01-15');
  await user.keyboard('{ArrowDown}');
  expect(calendar.contains(document.activeElement)).toBe(true);
  await user.keyboard('{ArrowRight}{Enter}');
  await waitFor(() => expect(input).toHaveValue('2030-01-16'));
  await waitFor(() => expect(input).toHaveFocus());

  await user.click(screen.getByRole('button', { name: '검색' }));
  expect(onChange).toHaveBeenCalledWith({ ...defaultFilters, due_date: '2030-01-16' });
});

it('opens and dismisses the calendar from the keyboard', async () => {
  const user = userEvent.setup();
  render(<ProjectFilterForm filters={defaultFilters} onChange={vi.fn()} />);
  const input = screen.getByRole('combobox', { name: '마감일' });
  input.focus();
  await user.keyboard('{ArrowDown}');
  const calendar = await screen.findByRole('dialog', { name: '마감일 달력' });
  await waitFor(() =>
    expect(within(calendar).getByRole('grid').contains(document.activeElement)).toBe(true),
  );
  await user.keyboard('{Escape}');
  await waitFor(() => expect(input).toHaveFocus());
  expect(screen.queryByRole('dialog', { name: '마감일 달력' })).not.toBeInTheDocument();
});
