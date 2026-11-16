// Purpose: Bind the shared Space library, search and pagination to the URL.
// Pattern: Route-owned state; feature owns API integration and transient drafts.
// Usage: Mounted at /home/space/library with no account or project prerequisite.
// Related: features/space/index.ts, app/app.tsx.
import { useSearchParams } from 'react-router';
import { SpaceDirectory } from '@/features/space';
export function SpacePage() {
  const [params, setParams] = useSearchParams();
  const raw = Number(params.get('offset') ?? 0),
    offset =
      Number.isSafeInteger(raw) && raw >= 0 && raw <= 1_000_000 ? Math.floor(raw / 12) * 12 : 0;
  const status =
    params.get('status') === 'all'
      ? 'all'
      : params.get('status') === 'archived'
        ? 'archived'
        : 'active';
  return (
    <SpaceDirectory
      kind={
        params.get('tab') === 'templates'
          ? 'templates'
          : params.get('tab') === 'references'
            ? 'references'
            : 'all'
      }
      q={(params.get('q') ?? '').slice(0, 80)}
      status={status}
      offset={offset}
      onNavigate={(value) => {
        const next = new URLSearchParams({ tab: value.kind });
        if (value.q) next.set('q', value.q);
        if (value.status !== 'active') next.set('status', value.status);
        if (value.offset) next.set('offset', String(value.offset));
        setParams(next);
      }}
    />
  );
}
