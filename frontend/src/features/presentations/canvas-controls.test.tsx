// Purpose: Preserve fractional numeric drafts and commit direct placement only on explicit submission.
// Pattern: Actual Radix/shadcn controls; source frames remain unchanged until a command callback.
// Usage: Vitest; real pointer/rendering and browser form validation are covered end to end.
// Related: canvas-controls.tsx, canvas-authoring.cjs.
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CanvasControls } from './canvas-controls';
import type { SlideObject } from './slide-spec';
afterEach(cleanup);
test('numeric placement supports clearing fractional values without NaN or premature saves', () => {
  const object: SlideObject = {
    id: 'shape',
    name: '도식',
    frame: { x: 29.222, y: 24.865, width: 40, height: 20, rotation: 0 },
    content: { kind: 'shape', shape: 'rectangle', fill: '#E3EAE4' },
  };
  const apply = vi.fn();
  render(
    <CanvasControls
      project="project"
      objects={[object]}
      selected={['shape']}
      enabled
      onApply={apply}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: '선택한 객체 위치·크기' }));
  const input = screen.getByLabelText('가로 위치 (%)') as HTMLInputElement;
  fireEvent.change(input, { target: { value: '' } });
  expect(input.value).toBe('');
  fireEvent.change(input, { target: { value: '25' } });
  expect(input.value).toBe('25');
  expect(apply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '배치 적용' }));
  expect(apply).toHaveBeenCalledTimes(1);
  expect(apply.mock.calls[0]?.[0]).toEqual({
    kind: 'geometry',
    placements: [{ object_id: 'shape', frame: { ...object.frame, x: 25 } }],
  });
  expect(object.frame.x).toBe(29.222);
});
