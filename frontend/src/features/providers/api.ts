// Purpose: Define versioned provider DTOs and explicit diagnostic API calls.
// Pattern: Zod response boundaries over the common Axios transport.
// Usage: Admin settings, model discovery and scoped diagnostic results.
// Related: backend/src/adapters/http/providers.rs, shared/api/http.ts.
import { capacityBounds } from './capacity-api';
import { z } from 'zod';
import { providerCatalogSchema } from './provider-types';
import { request } from '@/shared/api/http';
export const efforts = ['low', 'medium', 'high', 'xhigh'] as const;
const effortSchema = z.enum(efforts);
const providerSchema = z.object({
  id: z.uuid(),
  config_id: z.uuid(),
  version: z.number().int().positive(),
  name: z.string(),
  provider_type: z.string().min(1),
  base_url: z.string(),
  model_identifier: z.string(),
  timeout_seconds: z.number().int(),
  context_length: z.number().int().positive().nullish(),
  physical_batch_size: z.number().int().positive().nullish(),
  thinking: z.boolean().nullish(),
  thinking_effort: effortSchema.nullish(),
  max_output_tokens: z.number().int().min(256).max(65536).nullish(),
  enabled: z.boolean(),
  has_secret: z.boolean(),
  created_at: z.number(),
});
export type Provider = z.infer<typeof providerSchema>;
export type ProviderDraft = Pick<
  Provider,
  | 'name'
  | 'provider_type'
  | 'base_url'
  | 'model_identifier'
  | 'timeout_seconds'
  | 'max_output_tokens'
  | 'context_length'
  | 'thinking'
  | 'thinking_effort'
  | 'physical_batch_size'
  | 'enabled'
>;
export const recordSchema = z.object({
  id: z.uuid(),
  config_id: z.uuid(),
  kind: z.enum(['text', 'structured', 'decision']),
  status: z.enum(['running', 'succeeded', 'failed', 'interrupted']),
  elapsed_ms: z.number().nullable(),
  prompt_tokens: z.number().nullable(),
  completion_tokens: z.number().nullable(),
  error_code: z.string().nullable(),
  created_at: z.number(),
});
export const providerKeys = {
  all: ['providers'] as const,
  catalog: ['provider-types'] as const,
  history: (id: string) => ['providers', 'history', id] as const,
};
const root = '/api/v1/admin/llm/providers';
export const getProviderCatalog = (signal: AbortSignal) =>
  request('/api/v1/admin/llm/provider-types', providerCatalogSchema, { signal });
export const listProviders = (signal: AbortSignal) =>
  request(root, z.array(providerSchema), { signal });
export const getProvider = (id: string) => request(`${root}/${id}`, providerSchema);
export const draftBody = (
  expected_version: number,
  draft: ProviderDraft,
  api_key?: string,
  clear_secret = false,
  decision = false,
) =>
  JSON.stringify({
    name: draft.name,
    provider_type: draft.provider_type,
    base_url: draft.base_url,
    model_identifier: draft.model_identifier,
    timeout_seconds: draft.timeout_seconds,
    context_length: draft.context_length ?? null,
    physical_batch_size: draft.physical_batch_size ?? null,
    max_output_tokens: draft.max_output_tokens ?? null,
    thinking: decision ? null : (draft.thinking ?? null),
    thinking_effort: decision || !draft.thinking ? null : (draft.thinking_effort ?? null),
    decision,
    enabled: draft.enabled,
    expected_version,
    api_key,
    clear_secret,
  });
const diagnosticSchema = z.object({
  ticket: z.uuid().nullable(),
  message: z.string().optional(),
  accepted_efforts: z.array(effortSchema),
  effort_unverified: z.boolean().optional(),
  thinking_observed: z.boolean().optional(),
  effective_effort: effortSchema.nullable(),
  advertised: z.array(z.string()).nullable(),
});
export type DraftDiagnostic = z.infer<typeof diagnosticSchema>;
export const probeProvider = (id: string, body: string, signal: AbortSignal, timeout: number) =>
  request(`${root}/${id}/diagnose`, diagnosticSchema, { method: 'POST', body, signal, timeout });
export const saveProvider = (id: string, body: string, ticket: string) =>
  request(`${root}/${id}`, providerSchema, {
    method: 'PUT',
    body,
    headers: { 'X-Connection-Diagnostic': ticket },
  });
export const listModels = (provider: Provider, signal: AbortSignal) =>
  request(
    `${root}/${provider.id}/models?expected_version=${provider.version}`,
    z.array(z.string()),
    { signal, timeout: (provider.timeout_seconds + capacityBounds.wait + 5) * 1000 },
  );
export const testProvider = (
  provider: Provider,
  kind: 'text' | 'structured',
  signal: AbortSignal,
) =>
  request(`${root}/${provider.id}/test`, z.object({ request: recordSchema, text: z.string() }), {
    method: 'POST',
    body: JSON.stringify({ expected_version: provider.version, kind }),
    signal,
    timeout: (provider.timeout_seconds + capacityBounds.wait + 5) * 1000,
  });
export const getHistory = (id: string, signal: AbortSignal) =>
  request(`${root}/${id}/requests`, z.array(recordSchema), { signal });

export type DiscoveryInput = {
  connection_id?: string;
  expected_version?: number;
  provider_type: string;
  base_url?: string;
  api_key?: string;
  clear_secret: boolean;
};
export const discoverModels = (input: DiscoveryInput, signal: AbortSignal) =>
  request('/api/v1/admin/llm/models/discover', z.array(z.string().min(1).max(200)).max(1000), {
    method: 'POST',
    body: JSON.stringify(input),
    signal,
    timeout: 635000,
  });

export const prepareModel = (provider: Provider) =>
  request(`${root}/${provider.id}/prepare`, z.object({ instance_id: z.string() }), {
    method: 'POST',
    body: JSON.stringify({ expected_version: provider.version }),
    timeout: (provider.timeout_seconds + capacityBounds.wait + 5) * 1000,
  });
