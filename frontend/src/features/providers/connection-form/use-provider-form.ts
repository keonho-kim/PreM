// Purpose: Own model configuration drafts, conflict refresh and credential replacement.
// Pattern: Feature-owned state and presentational composition have separate owners.
// Usage: Imported only by the owning feature.
// Related: index.tsx, ../api.ts, ../use-model-discovery.ts.
import { useEffect, useRef, useState } from 'react';
import { useForm, useWatch, useFormState } from 'react-hook-form';
import { formValues, draftFields, type ConnectionValues } from './form-values';
import { useMutation } from '@tanstack/react-query';
import { ApiError, errorMessage } from '@/shared/api/http';
import { useDraftDiagnostic } from './use-draft-diagnostic';
import { draftBody, getProvider, saveProvider, type Provider, type ProviderDraft } from '../api';
import type { ProviderOption } from '../provider-types';
import { useModelDiscovery } from '../use-model-discovery';
export type ProviderFormProps = {
  provider: Provider | null;
  catalog: ProviderOption[];
  onSaved: (provider: Provider) => void;
  decision?: boolean;
};
export function useProviderForm({
  provider,
  catalog,
  onSaved,
  decision = false,
}: ProviderFormProps) {
  const initial = catalog[0];
  if (!initial) throw new Error('Provider catalog must be loaded before opening settings');
  const id = useRef(provider?.id ?? crypto.randomUUID());
  const [base, setBase] = useState(provider);
  const form = useForm<ConnectionValues>({ defaultValues: formValues(provider, initial) });
  const { control, register, setValue, reset: resetForm, handleSubmit } = form;
  const draft = useWatch({ control, name: 'draft' });
  const [address, secret, clearSecret] = useWatch({
    control,
    name: ['address', 'secret', 'clearSecret'],
  });
  const { isDirty, dirtyFields } = useFormState({ control });
  // These controls are composed through shadcn; register their names with the form owner.
  useEffect(() => {
    for (const key of draftFields) register(`draft.${key}`);
    register('address');
    register('secret');
    register('clearSecret');
  }, [register]);
  const updateDraft = <K extends keyof ProviderDraft>(key: K, value: ProviderDraft[K]) => {
    if (key === 'thinking' || key === 'thinking_effort') diagnostic.onThinkingEdit();
    setValue<`draft.${keyof ProviderDraft}`>(`draft.${key}`, value, { shouldDirty: true });
  };
  const setAddress = (value: string) => setValue('address', value, { shouldDirty: true });
  const setSecret = (value: string) => setValue('secret', value, { shouldDirty: true });
  const setClearSecret = (value: boolean) => setValue('clearSecret', value, { shouldDirty: true });
  const [notice, setNotice] = useState('');
  const [reviewAddress, setReviewAddress] = useState(false);
  const discovery = useModelDiscovery({
    connection_id: base?.id,
    expected_version: base?.version,
    provider_type: draft.provider_type,
    base_url: address.trim() || undefined,
    api_key: secret || undefined,
    clear_secret: clearSecret,
  });
  const connectionEdited =
    !base ||
    Boolean(address || secret || clearSecret) ||
    draft.provider_type !== base.provider_type;
  const modelReady =
    Boolean(draft.model_identifier) &&
    (discovery.models?.includes(draft.model_identifier) ||
      (!connectionEdited && draft.model_identifier === base?.model_identifier));
  const decisionMode = decision || initial.category === 'system';
  const body = draftBody(
    base?.version ?? 0,
    { ...draft, base_url: address.trim() || base?.base_url || '' },
    secret || undefined,
    clearSecret,
    decisionMode,
  );
  const diagnostic = useDraftDiagnostic(id.current, body, draft.timeout_seconds, modelReady);
  const mutation = useMutation({
    meta: { admin: true },
    mutationFn: () => {
      if (!diagnostic.result?.ticket) throw Error('연결 진단이 필요합니다.');
      return saveProvider(id.current, body, diagnostic.result.ticket);
    },
    retry: false,
    onSuccess: (p) => {
      setBase(p);
      resetForm(formValues(p, initial));
      setReviewAddress(false);
      setNotice('설정을 저장했습니다.');
      onSaved(p);
    },
  });
  const refresh = useMutation({
    meta: { admin: true },
    mutationFn: () => getProvider(id.current),
    onSuccess: (p) => {
      if (base && (p.base_url !== base.base_url || p.provider_type !== base.provider_type)) {
        setReviewAddress(true);
      }
      // RHF retains edited fields and adopts remote changes for untouched fields.
      resetForm(formValues(p, initial), { keepDirtyValues: true });
      setBase(p);
      mutation.reset();
      setNotice(
        `최신 v${p.version}: ${p.model_identifier}. 입력한 변경 사항은 유지했습니다. 확인 후 다시 저장하세요.`,
      );
    },
  });
  const pending = mutation.isPending || refresh.isPending;
  const changed = !base || isDirty || Object.keys(dirtyFields).length > 0;
  useEffect(() => {
    if (provider && base && provider.version > base.version && !changed && !pending) {
      setBase(provider);
      resetForm(formValues(provider, initial));
      setNotice('최신 모델 설정을 불러왔습니다.');
    }
  }, [provider, base, changed, pending, resetForm, initial]);
  const destinationChanged = Boolean(
    base &&
      ((address.trim() && address.trim() !== base.base_url) ||
        draft.provider_type !== base.provider_type),
  );
  const keyRequired = Boolean(base?.has_secret && destinationChanged && !secret && !clearSecret);
  const addressRequired = reviewAddress && Boolean(secret) && !address.trim();
  const conflict =
    diagnostic.conflict ||
    (mutation.error instanceof ApiError && mutation.error.code === 'revision_conflict') ||
    (discovery.error instanceof ApiError && discovery.error.code === 'revision_conflict');
  const error = mutation.isError
    ? errorMessage(mutation.error)
    : refresh.isError
      ? errorMessage(refresh.error)
      : '';
  const reset = () => {
    const latest = provider && base && base.version > provider.version ? base : provider;
    setBase(latest);
    resetForm(formValues(latest, initial));
    setReviewAddress(false);
    discovery.reset();
    setNotice('입력한 변경을 취소했습니다.');
    mutation.reset();
    refresh.reset();
  };
  const changes = base
    ? [
        draft.model_identifier !== base.model_identifier && '모델',
        address && '연결 주소',
        secret && 'API Key 교체',
        clearSecret && 'API Key 삭제',
        draft.name !== base.name && '표시 이름',
        draft.provider_type !== base.provider_type && '연결 방식',
        draft.timeout_seconds !== base.timeout_seconds && '응답 제한 시간',
        draft.max_output_tokens !== (base.max_output_tokens ?? null) && '최대 출력 토큰',
        draft.context_length !== (base.context_length ?? null) && '컨텍스트 길이',
        draft.physical_batch_size !== (base.physical_batch_size ?? null) && '물리 배치 크기',
        draft.enabled !== base.enabled && '연결 상태',
        !decisionMode &&
          (draft.thinking !== (base.thinking ?? null) ||
            draft.thinking_effort !== (base.thinking_effort ?? null)) &&
          'Thinking 설정',
      ]
        .filter(Boolean)
        .join(', ')
    : '새 AI 모델 연결';
  return {
    base,
    draft,
    updateDraft,
    handleSubmit,
    address,
    setAddress,
    secret,
    setSecret,
    clearSecret,
    setClearSecret,
    notice,
    setNotice,
    discovery,
    decisionMode,
    diagnostic,
    modelReady,
    mutation,
    refresh,
    pending,
    changed,
    keyRequired,
    addressRequired,
    conflict,
    error,
    reset,
    changes,
  };
}
