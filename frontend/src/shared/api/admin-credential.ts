// Purpose: Hold an Admin credential only for the current in-memory Admin visit.
// Pattern: Tiny external store; no URL, cookies, browser persistence or Query storage.
// Usage: Admin gate grants/revokes access; JSON transport reads it only for Admin paths.
// Related: http.ts, features/admin-access/admin-gate.tsx.
let token: string | null = null;
const listeners = new Set<() => void>();
export const readAdminToken = () => token;
export const hasAdminAccess = () => token !== null;
export const subscribeAdminAccess = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export function grantAdminAccess(value: string) {
  token = value;
  for (const listener of listeners) listener();
}
export function clearAdminAccess(expected?: string) {
  if (token === null) return;
  if (expected !== undefined && token !== expected) return;
  token = null;
  for (const listener of listeners) listener();
}
