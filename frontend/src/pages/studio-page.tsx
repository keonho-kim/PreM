// Purpose: Route Studio to a shared project or a clear project-selection entry.
// Pattern: Route identity scopes component drafts and server caches.
// Usage: App mounts this page under /studio and /studio/:projectId.
// Related: features/studio/index.ts, app/app.tsx.
import { Link, useParams } from '@tanstack/react-router';
import { StudioWorkspace } from '@/features/studio';
import { Button } from '@/components/ui/button';
export function StudioPage() {
  const { projectId } = useParams({ strict: false });
  return projectId ? (
    <StudioWorkspace key={projectId} projectId={projectId} />
  ) : (
    <main className="container workspace">
      <title>Studio | PreM</title>
      <h1>Studio</h1>
      <p>작업할 프로젝트를 Home에서 선택하세요.</p>
      <Button asChild>
        <Link to="/">프로젝트 선택</Link>
      </Button>
    </main>
  );
}
