// Purpose: Let team administrators tune simultaneous and waiting requests for an AI connection.
// Pattern: Query owns saved settings/counts; scoped drafts survive polling and explicit conflict review.
// Usage: ProviderPanels mounts this for LLM and System One; hidden tabs do not poll.
// Related: capacity-api.ts, provider-capacity.css, backend/adapters/http/model_capacity.rs.
import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { errorMessage } from '@/shared/api/http';
import {
  capacityBounds,
  capacityKey,
  getCapacity,
  saveCapacity,
  type Capacity,
  type CapacityLimits,
} from './capacity-api';
import './provider-capacity.css';
type Values = Record<keyof CapacityLimits, string>;
const values = (c: Capacity): Values => ({
  max_parallel: String(c.max_parallel),
  queue_capacity: String(c.queue_capacity),
  queue_timeout_seconds: String(c.queue_timeout_seconds),
});
const fields = [
  {
    key: 'max_parallel',
    label: '동시 처리 수',
    min: 1,
    max: capacityBounds.parallel,
    help: '이 연결로 한 번에 보낼 수 있는 요청 수입니다.',
  },
  {
    key: 'queue_capacity',
    label: '대기 가능한 요청 수',
    min: 0,
    max: capacityBounds.queue,
    help: '처리할 자리가 없을 때 기다릴 수 있는 요청 수입니다. 0이면 기다리지 않습니다.',
  },
  {
    key: 'queue_timeout_seconds',
    label: '최대 대기 시간 (초)',
    min: 1,
    max: capacityBounds.wait,
    help: '이 시간 안에 시작하지 못하면 다시 시도하도록 안내합니다.',
  },
] as const;
export function ProviderCapacity({ providerId, active }: { providerId: string; active: boolean }) {
  const prefix = useId();
  const cache = useQueryClient();
  const [draft, setDraft] = useState<{ version: number; values: Values } | null>(null);
  const [notice, setNotice] = useState('');
  const result = useQuery({
    queryKey: capacityKey(providerId),
    queryFn: ({ signal }) => getCapacity(providerId, signal),
    enabled: active,
    refetchInterval: active ? 3000 : false,
    retry: false,
  });
  const mutation = useMutation({
    meta: { admin: true },
    mutationFn: () => {
      if (!draft) throw new Error('No edited settings');
      return saveCapacity(providerId, draft.version, {
        max_parallel: Number(draft.values.max_parallel),
        queue_capacity: Number(draft.values.queue_capacity),
        queue_timeout_seconds: Number(draft.values.queue_timeout_seconds),
      });
    },
    retry: false,
    onSuccess: (saved) => {
      cache.setQueryData(capacityKey(providerId), saved);
      setDraft(null);
      setNotice('처리 설정을 저장했습니다.');
    },
  });
  async function review() {
    const refreshed = await result.refetch();
    if (refreshed.isError || !refreshed.data) return;
    const saved = refreshed.data;
    setDraft((current) => current && { ...current, version: saved.version });
    mutation.reset();
    setNotice(
      `현재 저장된 값은 동시 ${saved.max_parallel}개, 대기 ${saved.queue_capacity}개, ${saved.queue_timeout_seconds}초입니다. 입력한 값은 유지했습니다. 확인한 뒤 저장하세요.`,
    );
  }
  if (!result.data)
    return (
      <section className="provider-capacity" aria-label="처리 설정">
        <p role="status">
          {result.isError ? errorMessage(result.error) : '처리 설정을 불러옵니다.'}
        </p>
        {result.isError && (
          <Button variant="secondary" onClick={() => void result.refetch()}>
            다시 불러오기
          </Button>
        )}
      </section>
    );
  const saved = result.data;
  const current = draft?.values ?? values(saved);
  const changedElsewhere = draft !== null && draft.version !== saved.version;
  return (
    <section className="provider-capacity" aria-labelledby={`${prefix}-title`}>
      <header>
        <h2 id={`${prefix}-title`}>처리 설정</h2>
        <p>PreM에서 이 AI 연결에 보내는 요청 수와 대기 시간을 조절합니다.</p>
      </header>
      <dl className="capacity-live" aria-label="현재 요청 현황">
        <div>
          <dt>처리 중</dt>
          <dd>{result.isError ? '확인 필요' : `${saved.active}개`}</dd>
        </div>
        <div>
          <dt>대기 중</dt>
          <dd>{result.isError ? '확인 필요' : `${saved.queued}개`}</dd>
        </div>
      </dl>
      {result.isError && (
        <p role="status">최신 상태를 불러오지 못했습니다. 입력한 값은 유지됩니다.</p>
      )}
      <form
        aria-label="처리 설정 수정"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <fieldset disabled={mutation.isPending}>
          <legend className="sr-only">연결별 처리 한도</legend>
          {fields.map((field) => (
            <div className="capacity-field" key={field.key}>
              <Label htmlFor={`${prefix}-${field.key}`}>{field.label} · 필수</Label>
              <Input
                id={`${prefix}-${field.key}`}
                name={field.key}
                type="number"
                inputMode="numeric"
                step={1}
                required
                min={field.min}
                max={field.max}
                value={current[field.key]}
                aria-describedby={`${prefix}-${field.key}-help`}
                onChange={(event) => {
                  setDraft((previous) => ({
                    version: previous?.version ?? saved.version,
                    values: {
                      ...(previous?.values ?? values(saved)),
                      [field.key]: event.target.value,
                    },
                  }));
                  mutation.reset();
                  setNotice('');
                }}
              />
              <p id={`${prefix}-${field.key}-help`} className="field-hint">
                {field.help} {field.min}~{field.max}
              </p>
            </div>
          ))}
        </fieldset>
        <p className="field-hint">
          저장하면 재시작 없이 적용됩니다. 처리 중인 요청과 이미 기다리는 요청은 유지됩니다.
        </p>
        {changedElsewhere && (
          <p role="status">다른 곳에서 설정을 변경했습니다. 최신 설정을 확인한 뒤 저장해 주세요.</p>
        )}
        <div className="capacity-actions">
          <Button type="submit" disabled={mutation.isPending || draft === null || changedElsewhere}>
            {mutation.isPending ? '저장 중…' : '처리 설정 저장'}
          </Button>
          {(mutation.isError || changedElsewhere) && (
            <Button
              type="button"
              variant="secondary"
              disabled={result.isFetching || mutation.isPending}
              onClick={() => void review()}
            >
              최신 설정 확인
            </Button>
          )}
          {draft && (
            <Button
              type="button"
              variant="ghost"
              disabled={mutation.isPending}
              onClick={() => {
                setDraft(null);
                setNotice('');
                mutation.reset();
              }}
            >
              입력 취소
            </Button>
          )}
        </div>
        <p role="status">{mutation.isError ? errorMessage(mutation.error) : notice}</p>
      </form>
    </section>
  );
}
