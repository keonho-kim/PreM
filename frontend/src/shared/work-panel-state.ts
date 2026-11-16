// Purpose: Share this tab's work-panel presentation with the notification host.
// Pattern: Selector-based Zustand store containing ephemeral UI values only.
// Usage: UploadWorkPanel owns view and measurement; Feedback reads the measured height.
// Related: features/space/upload-work-panel.tsx, app/feedback.tsx.
import { create } from 'zustand';

type PanelView = 'expanded' | 'collapsed' | 'hidden';
type WorkPanelState = {
  view: PanelView;
  height: number;
  setView: (view: PanelView) => void;
  setHeight: (height: number) => void;
};

// No persistence or cross-tab broadcast: files and progress belong exclusively to Uppy.
export const useWorkPanelState = create<WorkPanelState>()((set) => ({
  view: 'expanded',
  height: 0,
  setView: (view) => set({ view }),
  setHeight: (height) => set({ height }),
}));
