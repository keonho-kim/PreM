// Purpose: Expose the Admin route's credential boundary.
// Pattern: One public gate; credential state and verification remain privately composed.
// Usage: pages/admin-page.tsx wraps settings before any sensitive view mounts.
// Related: admin-gate.tsx, shared/api/admin-credential.ts.
export { AdminGate } from './admin-gate';

export { GeneralSettings } from './general-settings';
