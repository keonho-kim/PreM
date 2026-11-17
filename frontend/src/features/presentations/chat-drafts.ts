// Purpose: Preserve unsent chat requests by project, presentation revision and slide.
// Pattern: Bounded in-memory Zustand state; no browser persistence or duplicated server messages.
// Usage: SlideChat owns its exact immutable scope key and updates only that draft.
// Related: edit-api.ts, slide-chat.tsx.
import { create } from 'zustand';
type Draft = { prompt: string };
export const emptyChatDraft: Draft = { prompt: '' };
export const useChatDrafts = create<{
  drafts: Record<string, Draft>;
  update: (key: string, change: Partial<Draft>) => void;
}>((set) => ({
  drafts: {},
  update: (key, change) =>
    set((state) => ({
      drafts: Object.fromEntries([
        ...Object.entries(state.drafts)
          .filter(([k]) => k !== key)
          .slice(-127),
        [key, { ...(state.drafts[key] ?? emptyChatDraft), ...change }],
      ]),
    })),
}));
