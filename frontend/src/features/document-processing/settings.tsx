// Purpose: Select the explicit LLM bridge or System One connection used by new reference jobs.
// Pattern: Query-owned settings with CAS updates; changing defaults never reruns finished work.
// Usage: Decision Model connection settings; templates never consume this setting.
// Related: api.ts, features/providers public facade, backend document_processing_settings.
import { useState } from 'react';
import './settings.css';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { listProviders, getProviderCatalog, providerKeys } from '@/features/providers';
import { errorMessage } from '@/shared/api/http';
import { getSettings, saveSettings, processingKeys } from './api';
export function ProcessingSettings() {
  const cache = useQueryClient();
  const [draft, setDraft] = useState<{ id: string; version: number } | null>(null);
  const settings = useQuery({
    queryKey: processingKeys.settings,
    queryFn: ({ signal }) => getSettings(signal),
  });
  const providers = useQuery({
    queryKey: providerKeys.all,
    queryFn: ({ signal }) => listProviders(signal),
  });
  const catalog = useQuery({
    queryKey: providerKeys.catalog,
    queryFn: ({ signal }) => getProviderCatalog(signal),
  });
  const save = useMutation({
    meta: { admin: true },
    mutationFn: () =>
      saveSettings(
        draft?.version ?? 0,
        (draft?.id ?? settings.data?.connection_id) === 'none'
          ? null
          : (draft?.id ?? settings.data?.connection_id ?? null),
      ),
    retry: false,
    onSuccess: () => {
      setDraft(null);
      void cache.invalidateQueries({ queryKey: processingKeys.settings });
      void cache.invalidateQueries({ queryKey: processingKeys.all });
    },
  });
  const options =
    providers.data?.filter(
      (p) =>
        p.enabled &&
        catalog.data?.some(
          (c) => c.id === p.provider_type && (c.structured || c.category === 'system'),
        ),
    ) ?? [];
  const error = settings.error ?? providers.error ?? catalog.error;
  return (
    <section className="processing-settings">
      <h2>사용 중인 판정 모델</h2>
      <p>문서 처리·자료 찾기에 함께 사용합니다.</p>
      {error ? (
        <p role="status">
          {errorMessage(error)}{' '}
          <Button
            variant="secondary"
            onClick={() => {
              void settings.refetch();
              void providers.refetch();
              void catalog.refetch();
            }}
          >
            다시 불러오기
          </Button>
        </p>
      ) : settings.isPending || providers.isPending || catalog.isPending ? (
        <p role="status">설정을 불러옵니다.</p>
      ) : (
        <>
          <Label htmlFor="processing-model">사용할 판정 연결</Label>
          <Select
            value={draft?.id ?? settings.data?.connection_id ?? 'none'}
            disabled={save.isPending}
            onValueChange={(value) => {
              setDraft({ id: value, version: draft?.version ?? settings.data?.version ?? 0 });
              save.reset();
            }}
          >
            <SelectTrigger id="processing-model">
              <SelectValue placeholder="연결을 선택하세요" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">선택 안 함 · 처리 중지</SelectItem>
              {options.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name} ·{' '}
                  {catalog.data?.find((c) => c.id === p.provider_type)?.category === 'system'
                    ? 'System One'
                    : 'LLM 판정'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!options.length && (
            <p>모델 연결에서 구조화 출력이 가능한 LLM 또는 System One 연결을 먼저 등록하세요.</p>
          )}
          <Button disabled={save.isPending || draft === null} onClick={() => save.mutate()}>
            판정 연결 적용
          </Button>
        </>
      )}
      <p role="status">
        {save.isPending
          ? '저장 중…'
          : save.isError
            ? errorMessage(save.error)
            : save.isSuccess
              ? '설정을 저장했습니다.'
              : ''}
      </p>
      {save.isError && (
        <Button
          variant="secondary"
          onClick={async () => {
            const result = await settings.refetch();
            if (result.data)
              setDraft((old) => (old ? { ...old, version: result.data.version } : null));
          }}
        >
          최신 설정 확인
        </Button>
      )}
    </section>
  );
}
