// Purpose: Select the team's relation-comparison model independently from extraction classification.
// Pattern: Existing provider catalog and CAS settings; active searches keep their original model.
// Usage: Admin's 자료 찾기 section.
// Related: api.ts, features/providers public facade.
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
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
import { getSettings, saveSettings, relationKeys } from './api';
export function RelationSettings() {
  const client = useQueryClient(),
    [draft, setDraft] = useState<{ id: string; planner: string; version: number } | null>(null);
  const settings = useQuery({
    queryKey: relationKeys.settings,
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
        draft?.id === 'none' ? null : (draft?.id ?? null),
        draft?.planner === 'none' ? null : (draft?.planner ?? null),
      ),
    retry: false,
    onSuccess: () => {
      setDraft(null);
      void client.invalidateQueries({ queryKey: relationKeys.settings });
    },
  });
  const options =
    providers.data?.filter(
      (p) =>
        p.enabled &&
        catalog.data?.some(
          (c) => c.id === p.provider_type && (c.category === 'system' || c.structured),
        ),
    ) ?? [];
  const error = settings.error ?? providers.error ?? catalog.error;
  return (
    <section className="processing-settings">
      <title>자료 찾기 · Admin | PuPuTyX</title>
      <h1 tabIndex={-1}>자료 찾기</h1>
      <p>
        현재 작업과 과거 문서의 관계를 비교할 AI를 선택하세요. 문서 정리에 사용하는 설정과 별도로
        관리합니다.
      </p>
      {error ? (
        <p role="alert">
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
            현재 저장:{' '}
            {providers.data?.find((p) => p.id === settings.data?.connection_id)?.name ??
              '선택 안 함'}
          </p>
          <Label htmlFor="relation-model">자료 비교에 사용할 AI</Label>
          <Select
            value={draft?.id ?? settings.data?.connection_id ?? 'none'}
            onValueChange={(id) =>
              setDraft((old) => ({
                id,
                planner: old?.planner ?? settings.data?.planner_connection_id ?? 'none',
                version: old?.version ?? settings.data?.version ?? 0,
              }))
            }
          >
            <SelectTrigger id="relation-model">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">선택 안 함</SelectItem>
              {options.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name} ·{' '}
                  {catalog.data?.find((c) => c.id === p.provider_type)?.category === 'system'
                    ? 'Decision'
                    : 'LLM'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Label htmlFor="relation-planner">추가 검색어를 구성할 LLM (선택)</Label>
          <Select
            value={draft?.planner ?? settings.data?.planner_connection_id ?? 'none'}
            onValueChange={(planner) =>
              setDraft((old) => ({
                id: old?.id ?? settings.data?.connection_id ?? 'none',
                planner,
                version: old?.version ?? settings.data?.version ?? 0,
              }))
            }
          >
            <SelectTrigger id="relation-planner">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">원문에 나온 단어로 찾기</SelectItem>
              {providers.data
                ?.filter(
                  (p) =>
                    p.enabled &&
                    catalog.data?.some((c) => c.id === p.provider_type && c.category === 'llm'),
                )
                .map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <p className="field-hint">
            문맥이 부족한 자료는 주변 내용을 다시 확인합니다. LLM을 선택하면 부족한 조건에 맞는 추가
            검색어를 구성합니다. 선택하지 않으면 원문에서 읽은 단어로만 검색합니다.
          </p>
          {!options.length && (
            <p>
              <Link to="/admin?section=providers">모델 연결</Link>에서 사용할 AI를 먼저 등록하세요.
            </p>
          )}
          <p className="field-hint">
            여러 자료를 병렬로 비교하며, 연결 종류에 맞게 요청을 구성합니다. 동시 처리와 대기열
            한도는 선택한 연결의 처리 설정을 따릅니다. 설정 변경은 완료된 검색을 다시 실행하지
            않습니다.
          </p>
          <Button disabled={draft === null || save.isPending} onClick={() => save.mutate()}>
            설정 저장
          </Button>
        </>
      )}
      <p role="status">
        {save.isError
          ? errorMessage(save.error)
          : save.isSuccess
            ? '설정을 저장했습니다.'
            : save.isPending
              ? '저장 중…'
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
