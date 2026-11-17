// Purpose: Share this tab's work-panel presentation with the notification host.
// Pattern: Redux slice holds ephemeral UI values; Uppy retains all upload state.
// Usage: App store composes the reducer; panel and feedback consume scoped selectors.
// Related: features/space/upload-work-panel.tsx, app/state/store.ts.
import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
type PanelView = 'expanded' | 'collapsed' | 'hidden';
type PanelState = { view: PanelView; height: number };
const initialState: PanelState = { view: 'expanded', height: 0 };
const panel = createSlice({
  name: 'workPanel',
  initialState,
  selectors: { selectPanelHeight: (state) => state.height, selectPanelView: (state) => state.view },
  reducers: {
    viewChanged(state, action: PayloadAction<PanelView>) {
      state.view = action.payload;
    },
    heightChanged(state, action: PayloadAction<number>) {
      state.height = action.payload;
    },
  },
});
export const workPanelReducer = panel.reducer;
export const { selectPanelHeight } = panel.selectors;
const { selectPanelView } = panel.selectors;
export function useWorkPanel() {
  const dispatch = useDispatch();
  const view = useSelector(selectPanelView);
  const setView = useCallback(
    (value: PanelView) => {
      dispatch(panel.actions.viewChanged(value));
    },
    [dispatch],
  );
  const setHeight = useCallback(
    (value: number) => {
      dispatch(panel.actions.heightChanged(value));
    },
    [dispatch],
  );
  return { view, setView, setHeight };
}
