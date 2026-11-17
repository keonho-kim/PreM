// Purpose: Review and save per-model settings while preserving concurrent edits and secrets.
// Pattern: Version-pinned form; empty endpoint/key drafts mean keep, explicit confirmation commits.
// Usage: Inline inside each LLM or Decision provider tab, for saved or new settings.
// Related: provider-connection-fields.tsx, api.ts, provider-panels.tsx.
import { useEffect, useId, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { ModelPicker } from './model-picker';
import { useModelDiscovery } from './use-model-discovery';
import { ProviderConnectionFields } from './provider-connection-fields';
import type { ProviderOption } from './provider-types';
import { ApiError, errorMessage } from '@/shared/api/http';
import { getProvider, saveProvider, type Provider, type ProviderDraft } from './api';
export function ProviderForm({
  provider,
  catalog,
  onSaved,
}: {
  provider: Provider | null;
  catalog: ProviderOption[];
  onSaved: (provider: Provider) => void;
}) {
  const prefix = useId();
  const initial = catalog[0];
  if (!initial) throw new Error('Provider catalog must be loaded before opening settings');
  const id = useRef(provider?.id ?? crypto.randomUUID());
  const submit = useRef<HTMLButtonElement>(null);
  const [base, setBase] = useState(provider);
  const [draft, setDraft] = useState<ProviderDraft>(provider ?? emptyDraft(initial));
  const [address, setAddress] = useState(provider ? '' : initial.base);
  const [secret, setSecret] = useState('');
  const [clearSecret, setClearSecret] = useState(false);
  const [notice, setNotice] = useState('');
  const [confirm, setConfirm] = useState(false);
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
  const mutation = useMutation({
    meta: { admin: true },
    mutationFn: () =>
      saveProvider(
        id.current,
        base?.version ?? 0,
        { ...draft, base_url: address.trim() || base?.base_url || '' },
        secret || undefined,
        clearSecret,
      ),
    retry: false,
    onSuccess: (p) => {
      setBase(p);
      setDraft(p);
      setAddress('');
      setSecret('');
      setClearSecret(false);
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
      // Adopt concurrent changes only for fields this form has not changed.
      setDraft((current) => ({
        ...p,
        ...Object.fromEntries(
          Object.entries(current).filter(([key, value]) => value !== base?.[key as keyof Provider]),
        ),
      }));
      setBase(p);
      mutation.reset();
      setNotice(
        `최신 v${p.version}: ${p.model_identifier}. 입력한 변경 사항은 유지했습니다. 확인 후 다시 저장하세요.`,
      );
    },
  });
  const pending = mutation.isPending || refresh.isPending;
  const fields: (keyof ProviderDraft)[] = [
    'name',
    'provider_type',
    'model_identifier',
    'timeout_seconds',
    'max_output_tokens',
    'enabled',
  ];
  const changed =
    !base ||
    Boolean(address || secret || clearSecret) ||
    fields.some((key) => draft[key] !== base[key]);
  useEffect(() => {
    if (provider && base && provider.version > base.version && !changed && !pending) {
      setBase(provider);
      setDraft(provider);
      setNotice('최신 모델 설정을 불러왔습니다.');
    }
  }, [provider, base, changed, pending]);
  const destinationChanged = Boolean(
    base &&
      ((address.trim() && address.trim() !== base.base_url) ||
        draft.provider_type !== base.provider_type),
  );
  const keyRequired = Boolean(base?.has_secret && destinationChanged && !secret && !clearSecret);
  const addressRequired = reviewAddress && Boolean(secret) && !address.trim();
  const conflict =
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
    setDraft(latest ?? emptyDraft(initial));
    setAddress(latest ? '' : initial.base);
    setSecret('');
    setClearSecret(false);
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
        draft.max_output_tokens !== base.max_output_tokens && '작성 출력 한도',
        draft.enabled !== base.enabled && '연결 상태',
      ]
        .filter(Boolean)
        .join(', ')
    : '새 AI 모델 연결';
  return (
    <form
      className="provider-form"
      aria-label="모델 연결 설정"
      onSubmit={(e) => {
        e.preventDefault();
        if (pending || !changed || keyRequired || addressRequired || conflict) return;
        if (!modelReady) {
          setNotice('모델 목록을 조회한 뒤 사용할 모델을 선택하세요.');
          return;
        }
        if (base) setConfirm(true);
        else {
          setNotice('');
          mutation.mutate();
        }
      }}
    >
      <ProviderConnectionFields
        prefix={prefix}
        base={base}
        draft={draft}
        catalog={catalog}
        pending={pending}
        address={address}
        secret={secret}
        clearSecret={clearSecret}
        addressRequired={addressRequired}
        update={(key, value) => setDraft((p) => ({ ...p, [key]: value }))}
        onAddress={setAddress}
        onSecret={(value) => {
          setSecret(value);
          setClearSecret(false);
        }}
        onClear={() => {
          setSecret('');
          setClearSecret((value) => !value);
        }}
        modelPicker={
          <ModelPicker
            prefix={prefix}
            kind={
              catalog.find((c) => c.id === draft.provider_type)?.category === 'system'
                ? 'Decision'
                : 'LLM'
            }
            value={draft.model_identifier}
            {...discovery}
            disabled={pending || keyRequired || addressRequired}
            onLoad={() => {
              void discovery.load();
            }}
            onCancel={discovery.cancel}
            onSelect={(model_identifier) => setDraft((old) => ({ ...old, model_identifier }))}
          />
        }
      />
      {addressRequired && (
        <p role="alert" className="field-hint">
          다른 접속자가 연결 대상을 변경했습니다. 새 키를 적용할 연결 주소를 다시 입력하세요.
        </p>
      )}
      {keyRequired && (
        <p className="field-hint">
          연결 주소나 방식을 바꾸려면 새 API Key를 입력하거나 저장된 키 삭제를 선택하세요.
        </p>
      )}
      <p role="status" className={error ? 'form-message error' : 'form-message'}>
        {pending ? '설정을 저장하고 있습니다.' : error || notice}
      </p>
      {conflict && (
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => refresh.mutate()}
        >
          최신 설정 확인
        </Button>
      )}
      <div className="dialog-actions">
        <Button type="button" variant="secondary" disabled={pending || !changed} onClick={reset}>
          변경 취소
        </Button>
        <Button
          ref={submit}
          type="submit"
          disabled={pending || !changed || keyRequired || addressRequired || conflict}
        >
          {pending ? '저장 중…' : base ? '변경 사항 저장' : '설정 저장'}
        </Button>
      </div>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent
          className="provider-confirmation"
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            submit.current?.focus();
          }}
        >
          <AlertDialogTitle>이 모델의 연결 설정을 변경할까요?</AlertDialogTitle>
          <AlertDialogDescription>
            {draft.model_identifier}에 적용됩니다. 저장 후 새 요청부터 사용하며, 진행 중인 작업은
            유지됩니다.
          </AlertDialogDescription>
          <p>변경 항목: {changes}</p>
          <div className="dialog-actions">
            <AlertDialogCancel>돌아가기</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setNotice('');
                mutation.mutate();
              }}
            >
              확인하고 저장
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}

function emptyDraft(option: ProviderOption): ProviderDraft {
  return {
    name: option.label,
    provider_type: option.id,
    base_url: option.base,
    model_identifier: '',
    timeout_seconds: 180,
    max_output_tokens: null,
    enabled: true,
  };
}
