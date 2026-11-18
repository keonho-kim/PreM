// Purpose: Open the selected project's Studio workspace.
// Pattern: Project identity scopes workspace drafts and server caches.
// Usage: Loaded on navigation to /studio/$projectId.
// Related: studio-page.tsx, features/studio/index.ts.
import { useParams } from '@tanstack/react-router';
import { StudioWorkspace } from '@/features/studio';
export function StudioProjectPage() {
  const { projectId } = useParams({ from: '/studio/$projectId' });
  return <StudioWorkspace key={projectId} projectId={projectId} />;
}
