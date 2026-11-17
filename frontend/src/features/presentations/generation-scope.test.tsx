// Purpose: Verify actual checkbox labels, mixed parent states and keyboard section selection.
// Pattern: Controlled feature wrapper with real shadcn/Radix behavior.
// Usage: Vitest; HTTP/rendering ownership is covered by presentation_scope and browser journeys.
// Related: generation-scope.tsx, generation-form.test.tsx.
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { GenerationScope } from './generation-scope';
const sections = [
  { id: 'root', parent_id: null, title: '업무 현황' },
  { id: 'a', parent_id: 'root', title: '현황 요약' },
  { id: 'b', parent_id: 'root', title: '실행 계획' },
  { id: 'c', parent_id: null, title: '마무리' },
];
function Scope() {
  const [selected, setSelected] = useState(['a', 'b', 'c']);
  return (
    <GenerationScope
      sections={sections}
      selected={selected}
      disabled={false}
      onChange={setSelected}
    />
  );
}
afterEach(cleanup);
it('expands branches and exposes partial selection while preserving independent sections', async () => {
  const user = userEvent.setup();
  render(<Scope />);
  await user.click(screen.getByRole('checkbox', { name: '현황 요약' }));
  expect(screen.getByRole('checkbox', { name: '업무 현황' })).toHaveAttribute(
    'aria-checked',
    'mixed',
  );
  expect(screen.getByRole('checkbox', { name: '전체 목차' })).toHaveAttribute(
    'aria-checked',
    'mixed',
  );
  expect(screen.getByText('2개 선택 · 목차 기준 2장')).toBeInTheDocument();
  await user.click(screen.getByRole('checkbox', { name: '업무 현황' }));
  expect(screen.getByRole('checkbox', { name: '현황 요약' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: '마무리' })).toBeChecked();
  await user.click(screen.getByRole('checkbox', { name: '전체 목차' }));
  expect(screen.getByText('0개 선택 · 목차 기준 0장')).toBeInTheDocument();
  screen.getByRole('checkbox', { name: '업무 현황' }).focus();
  await user.keyboard(' ');
  expect(screen.getByRole('checkbox', { name: '현황 요약' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: '실행 계획' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: '마무리' })).not.toBeChecked();
});

it('keeps row edit/add commands separate from selection and limits children to roots', async () => {
  const onEdit = vi.fn(),
    onAdd = vi.fn(),
    onChange = vi.fn();
  render(
    <GenerationScope
      sections={sections}
      selected={['a', 'b', 'c']}
      disabled={false}
      onEdit={onEdit}
      onAdd={onAdd}
      onChange={onChange}
    />,
  );
  await userEvent.click(screen.getByRole('button', { name: '업무 현황 수정' }));
  expect(onEdit).toHaveBeenCalledWith('root');
  await userEvent.click(screen.getByRole('button', { name: '업무 현황에 중목차 추가' }));
  expect(onAdd).toHaveBeenCalledWith('root');
  expect(screen.queryByRole('button', { name: '현황 요약에 중목차 추가' })).not.toBeInTheDocument();
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByRole('checkbox', { name: '업무 현황' })).toBeChecked();
});
