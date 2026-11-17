// Purpose: Compose the tab-local Redux UI store at the application boundary.
// Pattern: Feature-owned slices; Query/API credentials/files never enter Redux.
// Usage: Providers creates one store per mounted application; tests create isolated stores.
// Related: shared/work-panel-state.ts, features/presentations/chat-state/index.ts.
import { configureStore } from '@reduxjs/toolkit';
import { workPanelReducer } from '@/shared/work-panel-state';
import { chatDraftsReducer } from '@/features/presentations/chat-state';
export function createUiStore() {
  return configureStore({
    reducer: { workPanel: workPanelReducer, chatDrafts: chatDraftsReducer },
    devTools: false,
  });
}
