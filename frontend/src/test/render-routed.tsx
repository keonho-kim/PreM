// Purpose: Await real router initialization before feature assertions.
// Pattern: Testing Library act flushes TanStack Router's asynchronous initial match.
// Usage: Router-backed component tests; plain component tests use normal render.
// Related: router.tsx, features/*/*.test.tsx.
import { act, render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
export async function renderRouted(element: ReactElement): Promise<RenderResult> {
  let result!: RenderResult;
  await act(async () => {
    result = render(element);
  });
  return result;
}
