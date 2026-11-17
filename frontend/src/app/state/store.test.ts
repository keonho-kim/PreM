// Purpose: Verify tab isolation and bounded immutable-scope draft retention after Redux migration.
// Pattern: Real independent application stores and feature-owned actions.
// Usage: Vitest; upload panel and chat UI tests verify the consuming interactions.
// Related: store.ts, features/presentations/chat-state/index.ts.
import { expect, it } from 'vitest';
import { createUiStore } from './store';
import { draftUpdated, chatDraftSelectors } from '@/features/presentations/chat-state';
it('keeps UI drafts in their own tab and evicts only the oldest untouched scope', () => {
  const first = createUiStore(),
    second = createUiStore();
  for (let i = 0; i < 128; i++)
    first.dispatch(
      draftUpdated({ key: `project:revision:slide-${i}`, change: { prompt: `draft ${i}` } }),
    );
  first.dispatch(
    draftUpdated({ key: 'project:revision:slide-0', change: { prompt: 'recently edited' } }),
  );
  first.dispatch(
    draftUpdated({ key: 'other:revision:slide', change: { prompt: 'another project' } }),
  );
  expect(chatDraftSelectors.selectTotal(first.getState())).toBe(128);
  expect(chatDraftSelectors.selectById(first.getState(), 'project:revision:slide-0')?.prompt).toBe(
    'recently edited',
  );
  expect(
    chatDraftSelectors.selectById(first.getState(), 'project:revision:slide-1'),
  ).toBeUndefined();
  expect(chatDraftSelectors.selectTotal(second.getState())).toBe(0);
});
