// Purpose: Keep shared Home filters and pagination in the URL.
// Pattern: Route parsing with native form validation in the feature.
// Usage: Mounted at /home; browser back restores committed filters.
// Related: features/projects/index.ts, features/projects/api.ts.
import { useSearchParams } from 'react-router';
import { ProjectDirectory, defaultFilters, type ProjectFilters } from '@/features/projects';
export function ProjectsPage() {
  const [params, setParams] = useSearchParams();
  const raw = Number(params.get('offset') ?? 0);
  const offset =
    Number.isSafeInteger(raw) && raw >= 0 && raw <= 1_000_000 ? Math.floor(raw / 6) * 6 : 0;
  const filters: ProjectFilters = {
    q: (params.get('q') ?? '').slice(0, 80),
    due_date: params.get('due_date') ?? '',
    status:
      params.get('status') === 'archived'
        ? 'archived'
        : params.get('status') === 'all'
          ? 'all'
          : 'active',
    sort:
      params.get('sort') === 'deadline'
        ? 'deadline'
        : params.get('sort') === 'name'
          ? 'name'
          : 'recent',
  };
  function navigate(next: ProjectFilters, page: number) {
    const values = new URLSearchParams();
    for (const key of Object.keys(next) as (keyof ProjectFilters)[])
      if (next[key] && next[key] !== defaultFilters[key]) values.set(key, next[key]);
    if (page) values.set('offset', String(page));
    setParams(values);
  }
  return (
    <ProjectDirectory
      filters={filters}
      offset={offset}
      onFilter={(next) => navigate(next, 0)}
      onPage={(page) => navigate(filters, page)}
    />
  );
}
