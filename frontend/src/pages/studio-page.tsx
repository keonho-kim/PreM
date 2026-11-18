// Purpose: Open the shared project directory in Studio.
// Pattern: Reuse Home filters, creation, and project cards.
// Usage: Mounted at /studio before a project is selected.
// Related: projects-page.tsx, studio-project-page.tsx.
import { ProjectsPage } from './projects-page';
export function StudioPage() {
  return <ProjectsPage studio />;
}
