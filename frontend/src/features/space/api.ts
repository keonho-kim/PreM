// Purpose: Validate Space responses and define shared library query/mutation contracts.
// Pattern: Zod at the HTTP boundary; URL kinds select independent public libraries.
// Usage: Space directory, metadata dialogs and the Uppy upload engine.
// Related: backend/src/adapters/http/space/, shared/api/http.ts.
import { z } from 'zod';
import { request } from '@/shared/api/http';
export type LibraryKind = 'references' | 'templates' | `project-${string}`;
export type LibraryFilter = LibraryKind | 'all';
export const assetSchema = z.object({
  kind: z.union([z.enum(['references', 'templates']), z.templateLiteral(['project-', z.uuid()])]),
  id: z.uuid(),
  title: z.string(),
  tags: z.array(z.string()),
  status: z.enum(['active', 'archived']),
  version: z.number().int().positive(),
  file_version: z.number().int().positive(),
  filename: z.string(),
  sha256: z.string().length(64),
  size_bytes: z.number().int().positive(),
  mime: z.string(),
  format: z.string(),
  created_at: z.number(),
  updated_at: z.number(),
  processing: z.enum([
    'not_started',
    'queued',
    'extracting',
    'classifying',
    'waiting_configuration',
    'succeeded',
    'failed',
    'cancelled',
  ]),
});
export type Asset = z.infer<typeof assetSchema>;
const versionSchema = z.object({
  number: z.number().int().positive(),
  filename: z.string(),
  sha256: z.string(),
  size_bytes: z.number(),
  mime: z.string(),
  created_at: z.number(),
});
const listSchema = z.object({
  items: z.array(assetSchema),
  total: z.number().int().nonnegative(),
  limit: z.number(),
  offset: z.number(),
});
const uploadStatus = z.object({
  state: z.enum(['receiving', 'failed', 'cancelled', 'complete']),
  item_id: z.string().nullable(),
});
export const spaceKeys = {
  all: ['space'] as const,
  list: (kind: LibraryFilter, q: string, status: string, offset: number) =>
    ['space', 'list', kind, q, status, offset] as const,
  versions: (kind: LibraryKind, id: string) => ['space', 'versions', kind, id] as const,
};
export const listAssets = (
  kind: LibraryFilter,
  q: string,
  status: string,
  offset: number,
  signal: AbortSignal,
) =>
  request(
    `${assetPath(kind)}?${new URLSearchParams({ q, status, offset: String(offset), limit: '12' })}`,
    listSchema,
    { signal },
  );
export const assetPath = (kind: string) =>
  kind.startsWith('project-') ? `/api/v1/projects/${kind.slice(8)}/files` : `/api/v1/space/${kind}`;
export const getAsset = (kind: LibraryKind, id: string, signal?: AbortSignal) =>
  request(`${assetPath(kind)}/${id}`, assetSchema, { signal });
export const getVersions = (kind: LibraryKind, id: string, signal: AbortSignal) =>
  request(`${assetPath(kind)}/${id}/versions`, z.array(versionSchema), { signal });
export const changeMetadata = (kind: LibraryKind, item: Asset, title: string, tags: string[]) =>
  request(`${assetPath(kind)}/${item.id}`, assetSchema, {
    method: 'PATCH',
    body: JSON.stringify({ title, tags, expected_version: item.version }),
  });
export const changeStatus = (kind: LibraryKind, item: Asset, status: string) =>
  request(`${assetPath(kind)}/${item.id}`, assetSchema, {
    method: 'PATCH',
    body: JSON.stringify({ status, expected_version: item.version }),
  });
export const removeAsset = (kind: LibraryKind, item: Asset) =>
  request(`${assetPath(kind)}/${item.id}`, assetSchema, {
    method: 'DELETE',
    body: JSON.stringify({ expected_version: item.version }),
  });
export const cancelUpload = (key: string) =>
  request(`/api/v1/space/uploads/${key}`, uploadStatus, { method: 'DELETE' });
export const downloadUrl = (kind: LibraryKind, id: string, version?: number) =>
  `${assetPath(kind)}/${id}/download${version ? `?version=${version}` : ''}`;
export const metadataSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, '이름을 입력하세요.')
    .max(120, '이름은 최대 120자입니다.')
    .refine((value) => !/\p{Cc}/u.test(value), '제어 문자를 사용할 수 없습니다.'),
  tags: z.array(z.string().trim().min(1).max(24)).max(12, '태그는 최대 12개입니다.'),
});
export const parseTags = (value: string) =>
  Array.from(
    new Set(
      value
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  );
export const sizeLabel = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MiB`
    : `${Math.ceil(bytes / 1024)} KiB`;
