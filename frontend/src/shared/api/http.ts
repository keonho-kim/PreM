// Purpose: Own same-origin JSON transport and public error mapping.
// Pattern: Caller-provided response schemas, explicit cancellation and bounded requests.
// Usage: Feature API modules validate each success response through this transport.
// Related: features/projects/api.ts, lib/api.ts.
import axios from 'axios';
import { readAdminToken, clearAdminAccess } from './admin-credential';
import type { ZodType } from 'zod';

const client = axios.create({
  timeout: 10_000,
  headers: { Accept: 'application/json' },
  // HTTP failures keep the public API error contract; network/cancel errors stay distinct.
  validateStatus: () => true,
});
type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: HeadersInit;
  body?: string;
  binaryBody?: Blob;
  signal?: AbortSignal;
  timeout?: number;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
export async function request<T>(
  path: string,
  schema: ZodType<T>,
  init: RequestOptions = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  const adminToken = path.startsWith('/api/v1/admin/') ? readAdminToken() : null;
  if (adminToken && !headers.has('Authorization'))
    headers.set('Authorization', `Bearer ${adminToken}`);
  if (typeof init.body === 'string') headers.set('Content-Type', 'application/json');
  const response = await client.request<unknown>({
    url: path,
    method: init.method ?? 'GET',
    data: init.binaryBody ?? init.body,
    headers: Object.fromEntries(headers),
    signal: init.signal,
    timeout: init.timeout ?? 10_000,
  });
  if (response.status < 200 || response.status >= 300) {
    if (response.status === 401 && adminToken) clearAdminAccess(adminToken);
    const body = response.data;
    const error = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    throw new ApiError(
      response.status,
      typeof error.code === 'string' ? error.code : 'request_failed',
      typeof error.message === 'string'
        ? error.message
        : '요청을 처리하지 못했습니다. 다시 시도해 주세요.',
    );
  }
  return schema.parse(response.data);
}
export function errorMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : '서버에 연결하지 못했습니다. 입력한 내용은 유지됩니다. 다시 시도해 주세요.';
}
