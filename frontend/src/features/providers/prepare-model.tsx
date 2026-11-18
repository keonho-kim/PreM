// Purpose: Load a saved LM Studio token configuration only on an explicit Admin action.
// Pattern: Version-scoped mutation with feedback and no automatic retries.
// Usage: Saved connection settings; a matching loaded instance is reused.
// Related: api.ts, model-token-fields.tsx, adapters/http/model_load.rs.
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/shared/api/http';
import { prepareModel, type Provider } from './api';
export function PrepareModel({ provider, disabled }: { provider: Provider; disabled: boolean }) {
  const load = useMutation({
    meta: { admin: true },
    mutationFn: () => prepareModel(provider),
    retry: false,
  });
  return (
    <div>
      <Button
        type="button"
        variant="secondary"
        disabled={disabled || load.isPending}
        onClick={() => load.mutate()}
      >
        {load.isPending ? '모델 준비 중…' : '저장한 토큰 설정으로 모델 준비'}
      </Button>
      {load.isSuccess && <p role="status">준비된 모델: {load.data.instance_id}</p>}
      {load.isError && <p role="alert">{errorMessage(load.error)}</p>}
    </div>
  );
}
