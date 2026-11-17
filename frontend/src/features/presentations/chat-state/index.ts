// Purpose: Preserve unsent chat requests by project, presentation revision and slide.
// Pattern: Bounded in-memory Redux slice; no persistence or duplicated server messages.
// Usage: App composes the reducer; chat and inspector dispatch scoped draft changes.
// Related: edit-api.ts, slide-chat.tsx, app/state/store.ts.
import { createEntityAdapter, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { useDispatch, useSelector, useStore } from 'react-redux';
import { useCallback } from 'react';
type Draft = { prompt: string };
type DraftEntry = Draft & { scope: string };
const adapter = createEntityAdapter<DraftEntry, string>({ selectId: (draft) => draft.scope });
type DraftRoot = { chatDrafts: ReturnType<typeof adapter.getInitialState> };
const emptyChatDraft: Draft = { prompt: '' };
const slice = createSlice({
  name: 'chatDrafts',
  initialState: adapter.getInitialState(),
  reducers: {
    draftUpdated(state, { payload }: PayloadAction<{ key: string; change: Partial<Draft> }>) {
      const next = {
        scope: payload.key,
        ...(state.entities[payload.key] ?? emptyChatDraft),
        ...payload.change,
      };
      // Reinsert only the edited scope; insertion order is the bounded recency queue.
      adapter.removeOne(state, payload.key);
      adapter.addOne(state, next);
      if (state.ids.length > 128)
        adapter.removeMany(state, state.ids.slice(0, state.ids.length - 128));
    },
    resetDrafts: adapter.removeAll,
  },
});
export const chatDraftsReducer = slice.reducer;
export const { draftUpdated, resetDrafts } = slice.actions;
export const chatDraftSelectors = adapter.getSelectors<DraftRoot>((state) => state.chatDrafts);
export function useChatDraft(scope: string) {
  const draft = useSelector(
    (state: DraftRoot) => chatDraftSelectors.selectById(state, scope) ?? emptyChatDraft,
  );
  const dispatch = useDispatch();
  const store = useStore<DraftRoot>();
  const update = useCallback(
    (key: string, change: Partial<Draft>) => {
      dispatch(draftUpdated({ key, change }));
    },
    [dispatch],
  );
  const current = () => chatDraftSelectors.selectById(store.getState(), scope) ?? emptyChatDraft;
  return { draft, update, current };
}
