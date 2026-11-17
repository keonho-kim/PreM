// Purpose: Provide an isolated application UI store for component tests.
// Pattern: Real Redux reducers and Provider; no singleton state survives test mounts.
// Usage: Router tests compose this provider; non-router chat tests may supply an explicit store.
// Related: app/state/store.ts, router.tsx.
import { useState, type ReactNode } from 'react';
import { Provider } from 'react-redux';
import { createUiStore } from '@/app/state/store';
export const createTestStore = createUiStore;
export function UiTestProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createUiStore);
  return <Provider store={store}>{children}</Provider>;
}
