// Purpose: Expose Studio authoring and its completion query without leaking private editor state.
// Pattern: Narrow feature facade for the route and review stepper.
// Usage: features/studio/ composes this feature after source review.
// Related: workspace.tsx, api.ts.
export { OutlineWorkspace } from './workspace';
export { getOutline, outlineKeys } from './api';
