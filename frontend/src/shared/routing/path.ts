// Purpose: Read a route-relative pathname for shell presentation under an optional deployment base.
// Pattern: TanStack history remains authoritative; this only normalizes display matching.
// Usage: Header and global search decide their active presentation.
// Related: app/routing/router.tsx, search.ts.
import { useLocation, useRouter } from '@tanstack/react-router';
export function useAppPath() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const base = useRouter().options.basepath ?? '/';
  return base !== '/' && (pathname === base || pathname.startsWith(`${base}/`))
    ? pathname.slice(base.length) || '/'
    : pathname;
}
