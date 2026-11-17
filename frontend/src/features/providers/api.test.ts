// Purpose: Keep response-only provider fields out of the strict save request.
// Pattern: Verify serialization at the feature transport boundary.
// Usage: Vitest; protects edits initialized from a full server response.
// Related: api.ts, provider-form.tsx, backend/adapters/http/providers.rs.
import { expect, it, vi } from 'vitest';
import { request } from '@/shared/api/http';
import { saveProvider, type Provider } from './api';
vi.mock('@/shared/api/http', () => ({ request: vi.fn() }));
it('sends only editable settings and the explicit version precondition', () => {
  const provider: Provider = {
    id: 'resource',
    config_id: 'revision',
    version: 2,
    created_at: 1,
    has_secret: true,
    name: 'LM Studio',
    provider_type: 'lm_studio',
    base_url: 'http://localhost:1234/v1/',
    model_identifier: 'ornith-1.5-35b-a3b',
    timeout_seconds: 180,
    enabled: true,
  };
  saveProvider(provider.id, 2, provider);
  const body = JSON.parse(vi.mocked(request).mock.calls[0]?.[2]?.body ?? '{}');
  expect(body).toEqual({
    name: provider.name,
    provider_type: provider.provider_type,
    base_url: provider.base_url,
    model_identifier: provider.model_identifier,
    timeout_seconds: 180,
    enabled: true,
    expected_version: 2,
    max_output_tokens: null,
    clear_secret: false,
  });
});
