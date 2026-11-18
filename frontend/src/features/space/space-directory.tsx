// Purpose: Compose the real shared Space upload, discovery and version-management journey.
// Pattern: URL-owned filters, Query-owned canonical assets and one Uppy-owned upload queue.
// Usage: SpacePage is the route adapter; this feature does not depend on project state.
// Related: api.ts, upload-engine.ts, asset-card.tsx, space.css.
import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, FolderOpen, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SpaceFilters } from './space-filters';
import { Pagination, PaginationContent, PaginationItem } from '@/components/ui/pagination';
import { notify } from '@/shared/notifications';
import { errorMessage } from '@/shared/api/http';
import { listAssets, spaceKeys, type Asset, type LibraryKind, type LibraryFilter } from './api';
import { useUploadEngine } from './use-upload-engine';
import { LibraryUpload } from './upload-action';
import { UploadDialog } from './upload-dialog';
import { AssetCard, type AssetAction } from './asset-card';
import { AssetDialog } from './asset-dialog';
import { ProcessingDialog } from '@/features/document-processing';
import { VersionDialog } from './version-dialog';
import './space.css';
type Props = {
  kind: LibraryFilter;
  q: string;
  status: string;
  offset: number;
  onNavigate: (values: { kind: LibraryFilter; q: string; status: string; offset: number }) => void;
};
type Session = {
  action: AssetAction;
  kind: LibraryKind;
  item?: Asset;
  returnFocus?: HTMLElement;
};
export function SpaceDirectory({ kind, q, status, offset, onNavigate }: Props) {
  const client = useQueryClient(),
    heading = useRef<HTMLHeadingElement>(null);
  const engine = useUploadEngine();
  const [session, setSession] = useState<Session | null>(null),
    [notice, setNotice] = useState('');
  const result = useQuery({
    queryKey: spaceKeys.list(kind, q, status, offset),
    queryFn: ({ signal }) => listAssets(kind, q, status, offset, signal),
    refetchOnWindowFocus: true,
    refetchInterval: (q) =>
      q.state.data?.items.some((item) =>
        ['queued', 'extracting', 'classifying'].includes(item.processing),
      )
        ? 2000
        : 15000,
  });
  const total = result.data?.total;
  useEffect(() => {
    if (total !== undefined && offset > 0 && offset >= total)
      onNavigate({ kind, q, status, offset: Math.max(0, Math.ceil(total / 12) - 1) * 12 });
  }, [total, offset, kind, q, status, onNavigate]);
  function saved() {
    setSession(null);
    setNotice('자료 변경을 저장했습니다.');
    notify('자료 변경을 저장했습니다.');
    void client.invalidateQueries({ queryKey: spaceKeys.all });
    heading.current?.focus();
  }
  const label = kind === 'all' ? '자료' : kind === 'templates' ? '템플릿' : '레퍼런스';
  return (
    <main className="container workspace space-workspace">
      <title>자료 관리 · Space | PreM</title>
      <Link className="space-search-return" to="/space">
        Space 검색으로
      </Link>
      <div className="space-heading">
        <div>
          <p className="workspace-label">팀 공용 자산</p>
          <h1 ref={heading} tabIndex={-1}>
            자료 관리
          </h1>
          <p className="muted">레퍼런스와 PPTX 템플릿의 원본을 함께 관리하세요.</p>
        </div>
        <LibraryUpload kind={kind} />
      </div>
      <Tabs
        value={kind}
        activationMode="manual"
        onValueChange={(value) => {
          setNotice('');
          onNavigate({ kind: value as LibraryFilter, q, status, offset: 0 });
        }}
      >
        <TabsList aria-label="자산 종류">
          <TabsTrigger id="space-all-tab" value="all" aria-controls="space-library-panel">
            전체
          </TabsTrigger>
          <TabsTrigger
            id="space-references-tab"
            value="references"
            aria-controls="space-library-panel"
          >
            레퍼런스
          </TabsTrigger>
          <TabsTrigger
            id="space-templates-tab"
            value="templates"
            aria-controls="space-library-panel"
          >
            템플릿
          </TabsTrigger>
        </TabsList>
        <TabsContent id="space-library-panel" value={kind} aria-labelledby={`space-${kind}-tab`}>
          <SpaceFilters
            key={`${kind}-${q}-${status}`}
            q={q}
            status={status}
            onSubmit={(query, state) => {
              setNotice('');
              onNavigate({ kind, q: query, status: state, offset: 0 });
            }}
          />
          <div className="space-summary">
            <p role="status">
              {notice ||
                (result.isPending
                  ? '자료를 불러오고 있습니다.'
                  : result.isFetching
                    ? '목록을 갱신하고 있습니다.'
                    : `${total ?? 0}개 ${label}`)}
            </p>
            <Button
              variant="secondary"
              size="icon"
              title="자료 목록 새로고침"
              aria-label="자료 목록 새로고침"
              disabled={result.isFetching}
              onClick={() => {
                setNotice('');
                void result.refetch();
              }}
            >
              <RefreshCw aria-hidden="true" />
            </Button>
          </div>
          {result.isError && (
            <div className="space-error" role="alert">
              <p>{errorMessage(result.error)}</p>
              <Button
                variant="secondary"
                onClick={() => {
                  void result.refetch();
                }}
              >
                다시 불러오기
              </Button>
            </div>
          )}
          {result.data &&
            (result.data.items.length ? (
              <section className="space-gallery" aria-label={`${label} 목록`}>
                {result.data.items.map((item) => (
                  <AssetCard
                    key={`${item.kind}-${item.id}`}
                    item={item}
                    kind={item.kind}
                    onAction={(action, item, target) =>
                      setSession({
                        action,
                        kind: item.kind,
                        item,
                        returnFocus: target ?? undefined,
                      })
                    }
                  />
                ))}
              </section>
            ) : (
              <section className="space-empty">
                <FolderOpen size={32} aria-hidden="true" />
                <h2>
                  {q || status !== 'active'
                    ? '조건에 맞는 자료가 없습니다'
                    : kind === 'all'
                      ? '첫 자료를 올려보세요'
                      : `첫 ${label}${kind === 'templates' ? '을' : '를'} 올려보세요`}
                </h2>
                <p className="muted">
                  {q || status !== 'active'
                    ? '다른 검색어 또는 상태를 선택하세요.'
                    : '등록한 원본은 팀 전체와 공유되며 서버를 재시작해도 유지됩니다.'}
                </p>
              </section>
            ))}
          {result.data && (total ?? 0) > 12 && (
            <Pagination className="space-pagination" aria-label="자료 목록 페이지">
              <PaginationContent>
                <PaginationItem>
                  <Button
                    variant="secondary"
                    disabled={offset === 0}
                    onClick={() =>
                      onNavigate({ kind, q, status, offset: Math.max(0, offset - 12) })
                    }
                  >
                    <ArrowLeft aria-hidden="true" />
                    이전
                  </Button>
                </PaginationItem>
                <PaginationItem>
                  <span aria-current="page">
                    {Math.floor(offset / 12) + 1} / {Math.ceil((total ?? 0) / 12)}
                  </span>
                </PaginationItem>
                <PaginationItem>
                  <Button
                    variant="secondary"
                    disabled={offset + 12 >= (total ?? 0)}
                    onClick={() => onNavigate({ kind, q, status, offset: offset + 12 })}
                  >
                    다음
                    <ArrowRight aria-hidden="true" />
                  </Button>
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          )}
        </TabsContent>
      </Tabs>
      {session?.action === 'replace' && (
        <UploadDialog
          kind={session.kind}
          target={session.item}
          engine={engine}
          returnFocus={session.returnFocus}
          onClose={() => setSession(null)}
        />
      )}
      {session?.item && session.action === 'processing' && (
        <ProcessingDialog
          item={session.item}
          returnFocus={session.returnFocus}
          onClose={() => setSession(null)}
        />
      )}
      {session?.item && session.action === 'versions' && (
        <VersionDialog
          kind={session.kind}
          item={session.item}
          returnFocus={session.returnFocus}
          onClose={() => setSession(null)}
        />
      )}
      {session?.item &&
        (session.action === 'edit' ||
          session.action === 'status' ||
          session.action === 'delete') && (
          <AssetDialog
            kind={session.kind}
            item={session.item}
            action={session.action}
            returnFocus={session.returnFocus}
            onClose={() => setSession(null)}
            onSaved={saved}
          />
        )}
    </main>
  );
}
