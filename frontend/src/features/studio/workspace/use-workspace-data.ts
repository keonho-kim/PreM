// Purpose: Read project and six-stage review state through Query.
// Pattern: Feature-owned queries and view composition have separate owners.
// Usage: Studio workspace internal module.
// Related: index.tsx, ../api.ts.
import { useQuery } from '@tanstack/react-query';
import { getProject, listProjects, defaultFilters } from '@/features/projects';
import { listAssets, type LibraryKind } from '@/features/space';
import { getOutline, outlineKeys } from '@/features/outlines';
import { getPreparation, presentationKeys } from '@/features/presentations';
import { getReview, getGuide, studioKeys } from '../api';
export function useWorkspaceData(projectId: string, offset: number) {
  const kind: LibraryKind = `project-${projectId}`;
  const project = useQuery({
    queryKey: ['projects', projectId],
    queryFn: () => getProject(projectId),
    retry: false,
    refetchInterval: 15000,
  });
  const choices = useQuery({
    queryKey: ['projects', 'studio-choices'],
    queryFn: ({ signal }) => listProjects({ ...defaultFilters, status: 'all' }, 0, signal),
  });
  const files = useQuery({
    queryKey: studioKeys.files(projectId, offset),
    queryFn: ({ signal }) => listAssets(kind, '', 'active', offset, signal),
    refetchInterval: 2000,
  });
  const review = useQuery({
    queryKey: studioKeys.review(projectId),
    queryFn: ({ signal }) => getReview(projectId, signal),
    refetchInterval: 2000,
  });
  const guide = useQuery({
    queryKey: studioKeys.guide(projectId),
    queryFn: ({ signal }) => getGuide(projectId, signal),
  });
  const outline = useQuery({
    queryKey: outlineKeys.state(projectId),
    queryFn: ({ signal }) => getOutline(projectId, undefined, signal),
    enabled: !!review.data?.confirmed,
    refetchInterval: 2000,
  });
  const preparation = useQuery({
    queryKey: presentationKeys.preparation(projectId),
    queryFn: ({ signal }) => getPreparation(projectId, signal),
    refetchInterval: 2000,
  });
  return { kind, project, choices, files, review, guide, outline, preparation };
}
export type WorkspaceData = ReturnType<typeof useWorkspaceData>;
