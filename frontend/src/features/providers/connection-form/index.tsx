// Purpose: Review and save per-model settings while preserving concurrent edits and secrets.
// Pattern: Version-pinned form; empty endpoint/key drafts mean keep, explicit confirmation commits.
// Usage: Inline inside each LLM or Decision provider tab, for saved or new settings.
// Related: provider-connection-fields.tsx, api.ts, provider-panels.tsx.
import { useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { ModelPicker } from '../model-picker';
import { ProviderConnectionFields } from '../provider-connection-fields';
import { useProviderForm, type ProviderFormProps } from './use-provider-form';
export function ProviderForm(props: ProviderFormProps) {
  const { catalog } = props;
  const prefix = useId();
  const submit = useRef<HTMLButtonElement>(null);
  const [confirm, setConfirm] = useState(false);
  const {
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
  } = useProviderForm(props);
  return (
    <form
      className="provider-form"
      aria-label="모델 연결 설정"
      onSubmit={handleSubmit(() => {
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
      })}
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
        update={updateDraft}
        onAddress={setAddress}
        onSecret={(value) => {
          setSecret(value);
          setClearSecret(false);
        }}
        onClear={() => {
          setSecret('');
          setClearSecret(!clearSecret);
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
            onSelect={(value) => updateDraft('model_identifier', value)}
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
