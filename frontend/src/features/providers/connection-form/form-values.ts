// Purpose: Define editable connection fields and safe form defaults without stored credentials.
// Pattern: Explicit allowlist separates API metadata from React Hook Form values.
// Usage: Connection form initialization, successful save and conflict refresh.
// Related: use-provider-form.ts, ../api.ts.
import type { Provider, ProviderDraft } from '../api';
import type { ProviderOption } from '../provider-types';
export const draftFields = [
  'name',
  'provider_type',
  'base_url',
  'model_identifier',
  'timeout_seconds',
  'max_output_tokens',
  'context_length',
  'physical_batch_size',
  'enabled',
] as const;
export type ConnectionValues = {
  draft: ProviderDraft;
  address: string;
  secret: string;
  clearSecret: boolean;
};
export function formValues(provider: Provider | null, option: ProviderOption): ConnectionValues {
  return {
    draft: {
      name: provider?.name ?? option.label,
      provider_type: provider?.provider_type ?? option.id,
      base_url: provider?.base_url ?? option.base,
      model_identifier: provider?.model_identifier ?? '',
      timeout_seconds: provider?.timeout_seconds ?? 180,
      context_length: provider?.context_length ?? null,
      physical_batch_size: provider
        ? (provider.physical_batch_size ?? null)
        : (option.default_physical_batch_size ?? null),
      max_output_tokens: provider?.max_output_tokens ?? null,
      enabled: provider?.enabled ?? true,
    },
    address: provider ? '' : option.base,
    secret: '',
    clearSecret: false,
  };
}
