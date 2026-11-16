// Purpose: Read paged relationship results or the project's selected historical references.
// Pattern: Shared mutation invalidation with version conflicts surfaced beside the affected list.
// Usage: RelatedDocuments supplies a pinned search and current filter tab.
// Related: result-row.tsx, api.ts.
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/shared/api/http';
import {
  getResults,
  getSelected,
  selectItem,
  relationKeys,
  terminal,
  type SearchRun,
  type RelatedItem,
} from './api';
import { EvidenceWorkbench } from './evidence-workbench';
export function RelatedResults({
  project,
  run,
  kind,
  editable,
  active = true,
}: {
  project: string;
  run: SearchRun | null;
  kind: 'file' | 'block' | 'selected';
  editable: boolean;
  active?: boolean;
}) {
  const [offset, setOffset] = useState(0);
  const cache = useQueryClient();
  const result = useQuery<Awaited<ReturnType<typeof getResults>>>({
    queryKey:
      kind === 'selected'
        ? relationKeys.selected(project)
        : [...relationKeys.results(project, run?.id ?? '', kind, offset), run?.version],
    placeholderData: (previous) => previous,
    queryFn: ({ signal }) =>
      kind === 'selected'
        ? getSelected(project, signal)
        : getResults(project, run?.id ?? '', kind, offset, signal),
    enabled: active && (kind === 'selected' || !!run),
    refetchInterval: !active
      ? false
      : kind === 'selected' || (run && !terminal(run.status))
        ? 2000
        : 15000,
  });
  const select = useMutation({
    mutationFn: (item: RelatedItem) => selectItem(project, item),
    retry: false,
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: relationKeys.all });
    },
    onError: () => {
      void result.refetch();
    },
  });
  if (kind !== 'selected' && !run)
    return (
      <p className="related-empty">찾고 싶은 주제를 입력하거나 바로 관련 자료 찾기를 눌러주세요.</p>
    );
  return (
    <section
      className="evidence-results-section"
      aria-label={kind === 'selected' ? '선택한 참고 자료' : '검색 결과'}
    >
      {select.isError && (
        <p role="alert">
          {errorMessage(select.error)} 최신 선택 상태를 확인한 뒤 다시 선택해 주세요.
        </p>
      )}
      {result.isPending ? (
        <p role="status">자료를 불러옵니다.</p>
      ) : result.isError ? (
        <p role="alert">
          {errorMessage(result.error)}{' '}
          <Button variant="secondary" onClick={() => void result.refetch()}>
            다시 시도
          </Button>
        </p>
      ) : !result.data?.items.length ? (
        <p className="related-empty">
          {kind === 'selected'
            ? '아직 선택한 근거가 없습니다. 추가 검색에서 필요한 자료를 찾아 선택하세요.'
            : '이 범위에서 관련 자료를 찾지 못했습니다. 검색어 또는 범위를 바꿔보세요.'}
        </p>
      ) : (
        <>
          <p className="field-hint">
            {result.data.total}개 자료 · 내용과 날짜를 확인하고 현재 작업에 맞는 자료를 선택하세요.
          </p>
          <EvidenceWorkbench
            project={project}
            items={result.data.items}
            query={kind === 'selected' ? '' : (run?.query ?? '')}
            editable={editable}
            stale={!!run?.stale}
            pending={select.isPending}
            active={active}
            onSelect={(item) => {
              if (editable) select.mutate(item);
            }}
          />
          {kind !== 'selected' && result.data.total > 12 && (
            <footer className="related-pagination">
              <Button variant="secondary" disabled={!offset} onClick={() => setOffset(offset - 12)}>
                이전
              </Button>
              <span>
                {offset / 12 + 1} / {Math.ceil(result.data.total / 12)}
              </span>
              <Button
                variant="secondary"
                disabled={offset + 12 >= result.data.total}
                onClick={() => setOffset(offset + 12)}
              >
                다음
              </Button>
            </footer>
          )}
        </>
      )}
    </section>
  );
}
