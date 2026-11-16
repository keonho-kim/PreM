// Purpose: Expose only the project workspace UI to route composition.
// Pattern: Public feature facade with private transport and edit-session modules.
// Usage: ProjectsPage imports the shared directory through this entry point.
// Related: project-directory.tsx, pages/projects-page.tsx.
export { ProjectDirectory } from './project-directory';

export { defaultFilters, type ProjectFilters } from './api';

export { getProject, listProjects, listProjectOptions } from './api';
