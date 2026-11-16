// Purpose: Define the current shared-project HTTP contract and query keys.
// Pattern: Runtime-validated DTOs kept at the feature boundary.
// Usage: ProjectDirectory and ProjectDialog use these queries and commands.
// Related: shared/api/http.ts, backend/src/adapters/http/projects.rs.
import { z } from 'zod';
import { request } from '@/shared/api/http';
const projectSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  due_date: z.string().nullable(),
  status: z.enum(['active', 'archived']),
  deleted_at: z.number().nullable(),
  version: z.number().int().positive(),
  created_at: z.number().int().nonnegative(),
  updated_at: z.number().int().nonnegative(),
});
const listSchema = z.object({
  items: z.array(projectSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});
export type Project = z.infer<typeof projectSchema>;
export type ProjectFilters = {
  q: string;
  status: 'active' | 'archived' | 'all';
  due_date: string;
  sort: 'recent' | 'name' | 'deadline';
};
export const defaultFilters: ProjectFilters = {
  q: '',
  status: 'active',
  due_date: '',
  sort: 'recent',
};
export const pageSize = 6;
export const projectKeys = {
  all: ['projects'] as const,
  list: (filters: ProjectFilters, offset: number) => ['projects', 'list', filters, offset] as const,
};
export function listProjects(filters: ProjectFilters, offset: number, signal: AbortSignal) {
  const params = new URLSearchParams({
    ...filters,
    offset: String(offset),
    limit: String(pageSize),
  });
  if (!filters.due_date) params.delete('due_date');
  return request(`/api/v1/projects?${params}`, listSchema, { signal });
}
export const getProject = (id: string) =>
  request(`/api/v1/projects/${encodeURIComponent(id)}`, projectSchema);
export const createProject = (name: string, due_date: string, key: string) =>
  request('/api/v1/projects', projectSchema, {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: JSON.stringify({ name, due_date }),
  });
export const renameProject = (project: Project, name: string) =>
  request(`/api/v1/projects/${encodeURIComponent(project.id)}`, projectSchema, {
    method: 'PATCH',
    body: JSON.stringify({ name, expected_version: project.version }),
  });

export const changeProjectStatus = (project: Project) =>
  request(`/api/v1/projects/${project.id}`, projectSchema, {
    method: 'PATCH',
    body: JSON.stringify({
      status: project.status === 'active' ? 'archived' : 'active',
      expected_version: project.version,
    }),
  });
export const deleteProject = (project: Project) =>
  request(`/api/v1/projects/${project.id}`, projectSchema, {
    method: 'DELETE',
    body: JSON.stringify({ expected_version: project.version }),
  });

export const listProjectOptions = (signal: AbortSignal) =>
  request('/api/v1/projects?status=all&limit=100&sort=recent', listSchema, { signal });
