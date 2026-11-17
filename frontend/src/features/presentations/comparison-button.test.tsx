// Purpose: Verify hold comparison releases on keyboard, pointer cancellation and context changes.
// Pattern: Real shadcn button with controlled state; no timing-dependent fake long-press gesture.
// Usage: Vitest; real browser tests cover pointer capture and image switching.
// Related: comparison-button.tsx, canvas-toolbar.tsx.
import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, it, expect } from 'vitest';
import { ComparisonButton } from './comparison-button';
afterEach(cleanup);
function Harness({ scope = 'one' }: { scope?: string }) {
  const [held, setHeld] = useState(false);
  return (
    <>
      <ComparisonButton key={scope} disabled={false} held={held} onHold={setHeld} />
      <output>{held ? 'before' : 'current'}</output>
    </>
  );
}
it('compares only while Space/Enter is held, and releases for Escape and blur', () => {
  render(<Harness />);
  const b = screen.getByRole('button');
  b.focus();
  fireEvent.keyDown(b, { key: ' ' });
  expect(screen.getByText('before')).toBeVisible();
  fireEvent.keyUp(b, { key: ' ' });
  expect(screen.getByText('current')).toBeVisible();
  fireEvent.keyDown(b, { key: 'Enter' });
  fireEvent.keyDown(b, { key: 'Escape' });
  expect(b).toHaveAttribute('aria-pressed', 'false');
  fireEvent.keyDown(b, { key: ' ' });
  fireEvent.blur(b);
  expect(screen.getByText('current')).toBeVisible();
});
it('releases on pointer cancellation, page blur and slide change', () => {
  const { rerender } = render(<Harness />);
  const b = screen.getByRole('button');
  fireEvent.keyDown(b, { key: ' ' });
  fireEvent.pointerCancel(window);
  expect(screen.getByText('current')).toBeVisible();
  fireEvent.keyDown(b, { key: ' ' });
  fireEvent.blur(window);
  expect(screen.getByText('current')).toBeVisible();
  fireEvent.keyDown(b, { key: ' ' });
  rerender(<Harness scope="two" />);
  expect(screen.getByText('current')).toBeVisible();
});
