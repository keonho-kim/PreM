// Purpose: Select the explicit LLM bridge or System One connection used by new reference jobs.
// Pattern: Query-owned settings with CAS updates; changing defaults never reruns finished work.
// Usage: Admin document processing section; templates never consume this setting.
// Related: api.ts, features/providers public facade, backend document_processing_settings.
import { useState } from 'react';
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
  const [draft, setDraft] = useState<string | null>(null);
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
        settings.data?.version ?? 0,
        (draft ?? settings.data?.connection_id) === 'none'
          ? null
          : (draft ?? settings.data?.connection_id ?? null),
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
      <title>문서 처리 · Admin | PuPuTyX</title>
      <h1 tabIndex={-1}>문서 처리</h1>
      <p>레퍼런스의 목차 판정에 사용할 연결입니다. 템플릿은 PPT Master로만 추출합니다.</p>
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
          <p className="field-hint">
            저장된 설정 v{settings.data?.version}:{' '}
            {providers.data?.find((p) => p.id === settings.data?.connection_id)?.name ??
              '선택 안 함'}
          </p>
          <Label htmlFor="processing-model">레퍼런스 판정 모델</Label>
          <Select
            value={draft ?? settings.data?.connection_id ?? 'none'}
            disabled={save.isPending}
            onValueChange={(value) => {
              setDraft(value);
              save.reset();
            }}
          >
            <SelectTrigger id="processing-model">
              <SelectValue placeholder="연결을 선택하세요" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">선택 안 함 · 추출 후 대기</SelectItem>
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
          <p className="field-hint">
            실행 시 설정 버전을 고정합니다. 저장은 완료된 결과를 재생성하지 않으며, 설정을 기다리는
            작업만 이어갑니다.
          </p>
          <Button disabled={save.isPending || draft === null} onClick={() => save.mutate()}>
            설정 저장
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
        <Button variant="secondary" onClick={() => void settings.refetch()}>
          최신 설정 확인
        </Button>
      )}
    </section>
  );
}
