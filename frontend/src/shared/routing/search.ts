// Purpose: Preserve the application's string-valued query URLs on TanStack Router.
// Pattern: One URL codec; feature parsers retain validation and filter ownership.
// Usage: Router configuration and feature-owned URL filter transitions.
// Related: app/routing/router.tsx, features/search/api.ts.
import { useCallback } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
export type SearchValues = Record<string, string>;
export const parseSearch = (value: string): SearchValues =>
  Object.fromEntries(new URLSearchParams(value));
export function stringifySearch(value: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, entry] of Object.entries(value))
    if (entry !== undefined && entry !== null) params.set(key, String(entry));
  return params.size ? `?${params}` : '';
}
export const validateSearch = (value: Record<string, unknown>): SearchValues =>
  Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
type SearchUpdate =
  | URLSearchParams
  | Record<string, string>
  | ((previous: URLSearchParams) => URLSearchParams);
export function useUrlSearch() {
  const search = useSearch({ strict: false });
  const navigate = useNavigate();
  const update = useCallback(
    (next: SearchUpdate, options?: { replace?: boolean }) => {
      void navigate({
        to: '.',
        replace: options?.replace,
        search: (old) => {
          const result =
            typeof next === 'function' ? next(new URLSearchParams(validateSearch(old))) : next;
          return result instanceof URLSearchParams ? Object.fromEntries(result) : result;
        },
      });
    },
    [navigate],
  );
  return [new URLSearchParams(validateSearch(search)), update] as const;
}
