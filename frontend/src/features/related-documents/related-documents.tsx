// Purpose: Let users explicitly search and review relationships to past business documents.
// Pattern: Durable run identity in the URL, read-only polling and explicit cancel/retry commands.
// Usage: Studio evidence step owns selected references and explicit additional search.
// Related: search-form.tsx, results.tsx, settings.tsx.
import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { WorkflowStages } from '@/shared/ui/workflow-stages';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { errorMessage } from '@/shared/api/http';
import { getRun, search, command, terminal, relationKeys, type SearchInput } from './api';
import { SearchForm, payload, type Draft } from './search-form';
import { RelatedResults } from './results';
import './related.css';
export function RelatedDocuments({
  project,
  ready,
  editable,
}: {
  project: string;
  ready: boolean;
  editable: boolean;
}) {
  const [params, setParams] = useSearchParams(),
    cache = useQueryClient();
  const [tab, setTab] = useState('file');
  const receipt = useRef<{ stamp: string; key: string; input: SearchInput } | null>(null),
    control = useRef<{ stamp: string; key: string } | null>(null);
  const id = params.get('search');
  const legacy = params.get('step') === 'related';
  const view =
    params.get('evidence') === 'selected'
      ? 'selected'
      : legacy || params.get('evidence') === 'search' || id
        ? 'search'
        : 'selected';
  const setView = (value: string) =>
    setParams((old) => {
      const next = new URLSearchParams(old);
      next.set('step', 'evidence');
      next.set('evidence', value);
      return next;
    });
  const current = useQuery({
    queryKey: relationKeys.run(project, id),
    queryFn: ({ signal }) => getRun(project, id, signal),
    refetchInterval: (q) => (q.state.data && !terminal(q.state.data.status) ? 1000 : 15000),
    retry: false,
  });
  useEffect(() => {
    const latest = current.data;
    if ((!id && latest) || legacy)
      setParams(
        (old) => {
          const next = new URLSearchParams(old);
          next.set('step', 'evidence');
          if (legacy) next.set('evidence', 'search');
          else if (!next.has('evidence')) next.set('evidence', view);
          if (!next.has('search') && latest) next.set('search', latest.id);
          return next;
        },
        { replace: true },
      );
  }, [id, current.data, setParams, legacy, view]);
  const start = useMutation({
    mutationFn: (draft: Draft) => {
      const stamp = JSON.stringify(draft);
      if (receipt.current?.stamp !== stamp)
        receipt.current = { stamp, key: crypto.randomUUID(), input: payload(draft) };
      return search(project, receipt.current.input, receipt.current.key);
    },
    retry: false,
    onSuccess: (run) => {
      receipt.current = null;
      cache.setQueryData(relationKeys.run(project, run.id), run);
      setParams((old) => {
        const next = new URLSearchParams(old);
        next.set('step', 'evidence');
        next.set('evidence', 'search');
        next.set('search', run.id);
        return next;
      });
      setTab('file');
    },
  });
  const change = useMutation({
    mutationFn: (action: 'retry' | 'cancel') => {
      const run = current.data;
      if (!run) throw new Error('검색 상태를 다시 확인하세요.');
      const stamp = `${run.id}:${run.version}:${action}`;
      if (control.current?.stamp !== stamp) control.current = { stamp, key: crypto.randomUUID() };
      return command(project, run, action, control.current.key);
    },
    retry: false,
    onSuccess: () => {
      control.current = null;
      void cache.invalidateQueries({ queryKey: relationKeys.all });
    },
    onError: () => void current.refetch(),
  });
  const run = current.data ?? null,
    active = !!run && !terminal(run.status);
  return (
    <section className="related-workspace">
      <header>
        <h2>근거</h2>
        <p className="muted">
          선택한 참고 자료를 검토하고, 부족한 근거는 다른 프로젝트의 문서에서 추가로 찾아보세요.
        </p>
      </header>
      <Tabs className="evidence-tabs" value={view} onValueChange={setView} activationMode="manual">
        <TabsList aria-label="근거 작업">
          <TabsTrigger value="selected">선택한 근거</TabsTrigger>
          <TabsTrigger value="search">추가 검색</TabsTrigger>
        </TabsList>
        <TabsContent value="selected">
          {active && (
            <p role="status">추가 검색이 진행 중입니다. 선택한 근거를 계속 검토할 수 있습니다.</p>
          )}
          <RelatedResults project={project} run={run} kind="selected" editable={editable} />
        </TabsContent>
        <TabsContent value="search" forceMount hidden={view !== 'search'}>
          <div className="evidence-search">
            {!ready && (
              <p role="status">현재 프로젝트의 원본이 준비되면 자료를 비교할 수 있습니다.</p>
            )}
            <SearchForm
              project={project}
              disabled={!editable || !ready || active || start.isPending}
              busy={active || start.isPending}
              onSearch={(draft) => {
                change.reset();
                start.mutate(draft);
              }}
            />
            {(current.isError || start.isError || change.isError) && (
              <p role="alert">
                {errorMessage(start.error ?? change.error ?? current.error)}{' '}
                <Button variant="secondary" onClick={() => void current.refetch()}>
                  상태 다시 확인
                </Button>
              </p>
            )}
            {run && (
              <div className="related-progress">
                <WorkflowStages
                  steps={run.steps}
                  status={run.status}
                  name="자료 찾기 단계"
                  labels={{
                    retrieve: '후보 찾기',
                    review: '내용 비교·추가 확인',
                    publish: '결과 정리',
                  }}
                />
                <p className="field-hint">
                  검색 기준: {run.query || '현재 원본과 작성 방향'} ·{' '}
                  {run.options.previous_versions ? '이전 버전 포함' : '최신 파일 버전'} ·{' '}
                  {run.options.include_archived ? '보관 프로젝트 포함' : '진행 중인 프로젝트'}
                </p>
                <p role="status">
                  {run.status === 'waiting_configuration'
                    ? '자료 비교에 사용할 AI가 아직 선택되지 않았습니다.'
                    : run.status === 'failed'
                      ? '일부 자료를 비교하지 못했습니다. 완료된 내용은 유지됩니다.'
                      : run.status === 'cancelled'
                        ? '자료 찾기를 중단했습니다. 완료된 내용은 유지됩니다.'
                        : run.status === 'succeeded'
                          ? `${run.completed}개 후보를 확인했습니다.`
                          : run.exploration?.phase === 'context'
                            ? '앞뒤 문맥과 다른 자료를 함께 확인하고 있습니다.'
                            : run.exploration?.phase === 'discover'
                              ? '부족한 근거를 보완할 자료를 더 찾고 있습니다.'
                              : `관련 내용을 확인하고 있습니다. ${run.completed} / ${run.total}`}
                </p>
                {active && !run.exploration && run.total > 0 && (
                  <Progress
                    aria-label="자료 비교 진행률"
                    value={(100 * run.completed) / run.total}
                  />
                )}
                {run.exploration && (
                  <p className="field-hint">
                    모은 원문 {run.exploration.read_blocks}곳 · 추가로 찾은 후보{' '}
                    {run.exploration.added_candidates}개
                    {run.exploration.unresolved > 0 &&
                      ` · 직접 확인이 필요한 후보 ${run.exploration.unresolved}개`}
                    {run.exploration.stop_reason === 'budget' &&
                      ' · 조사 한도에 도달했습니다. 확인한 자료를 보존했습니다.'}
                    {run.exploration.stop_reason === 'no_new_results' &&
                      ' · 이번 검색에서는 더 추가할 자료를 찾지 못했습니다.'}
                    {run.exploration.stop_reason === 'needs_review' &&
                      ' · 근거가 부족하거나 조건이 다른 자료가 남아 있습니다.'}
                  </p>
                )}
                {run.status === 'waiting_configuration' && (
                  <Link to="/admin?section=decision">Admin에서 사용할 AI 선택</Link>
                )}
                {run.stale && (
                  <p role="status">
                    현재 원본 또는 작성 방향이 바뀌었습니다. 자료를 다시 찾은 뒤 선택해 주세요.
                  </p>
                )}
                {active ? (
                  <Button
                    variant="secondary"
                    disabled={change.isPending || !editable}
                    onClick={() => change.mutate('cancel')}
                  >
                    찾기 중단
                  </Button>
                ) : (
                  ['failed', 'cancelled'].includes(run.status) && (
                    <Button
                      variant="secondary"
                      disabled={change.isPending || !editable}
                      onClick={() => change.mutate('retry')}
                    >
                      이어서 찾기
                    </Button>
                  )
                )}
              </div>
            )}
            <Tabs
              className="evidence-candidate-tabs"
              value={tab}
              onValueChange={setTab}
              activationMode="manual"
            >
              <TabsList aria-label="추가 검색 결과">
                <TabsTrigger value="file">문서</TabsTrigger>
                <TabsTrigger value="block">내용</TabsTrigger>
              </TabsList>
              {(['file', 'block'] as const).map((kind) => (
                <TabsContent value={kind} key={kind}>
                  <RelatedResults
                    key={`${run?.id ?? 'none'}:${kind}`}
                    project={project}
                    run={run}
                    kind={kind}
                    editable={editable}
                    active={view === 'search'}
                  />
                </TabsContent>
              ))}
            </Tabs>
          </div>
        </TabsContent>
      </Tabs>
      <p className="field-hint">
        선택한 자료는 원래 문서 버전으로 연결됩니다. 과거의 일정·수치·주장이 이번 작업에도 그대로
        적용되는지는 원문을 확인해 주세요.
      </p>
    </section>
  );
}
