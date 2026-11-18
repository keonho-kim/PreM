// Purpose: Browse Space files and matched passages in a dedicated news-style results route.
// Pattern: URL filters and pagination, Query cancellation and link navigation without a modal.
// Usage: /home/space; project originals never enter this search scope.
// Related: api.ts, search-box.tsx, search.css, document-processing document-page.
import { Suspense, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useUrlSearch } from '@/shared/routing/search';
import { useQuery } from '@tanstack/react-query';
import { FileText, ArrowLeft, ArrowRight, SlidersHorizontal } from 'lucide-react';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { LibraryUpload, SpaceDirectory } from '@/features/space';
import { MatchText } from '@/shared/ui/match-text';
import { errorMessage } from '@/shared/api/http';
import {
  encodeSearch,
  findDocuments,
  searchParams,
  type SearchInput,
  type SearchItem,
} from './api';
import { SearchBox } from './search-box';
import './search.css';
function Filters({ input, apply }: { input: SearchInput; apply: (input: SearchInput) => void }) {
  const [mode, setMode] = useState(input.mode),
    [archived, setArchived] = useState(input.archived);
  return (
    <Collapsible className="search-options" defaultOpen={input.mode !== 'all' || input.archived}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost">
          <SlidersHorizontal aria-hidden="true" />
          검색 조건
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <form
          className="search-filters"
          onSubmit={(e) => {
            e.preventDefault();
            apply({ ...input, mode, archived, offset: 0 });
          }}
        >
          <div>
            <Label htmlFor="search-in">찾을 위치</Label>
            <Select value={mode} onValueChange={setMode}>
              <SelectTrigger id="search-in">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">파일 정보와 본문</SelectItem>
                <SelectItem value="files">파일 이름·태그</SelectItem>
                <SelectItem value="content">본문 내용</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="search-status">자료 상태</Label>
            <Select
              value={archived ? 'all' : 'active'}
              onValueChange={(v) => setArchived(v === 'all')}
            >
              <SelectTrigger id="search-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">활성 자료</SelectItem>
                <SelectItem value="all">보관 자료 포함</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" variant="secondary">
            적용
          </Button>
        </form>
      </CollapsibleContent>
    </Collapsible>
  );
}
function Result({ item, input }: { item: SearchItem; input: SearchInput }) {
  const query = new URLSearchParams({
    back: `/space?${encodeSearch(input)}`,
    ...(item.job_id ? { job: item.job_id } : {}),
    ...(item.page_id ? { page: item.page_id } : {}),
  });
  const destination = {
    to: '/space/documents/$kind/$id' as const,
    params: { kind: item.kind, id: item.id },
    search: Object.fromEntries(query),
  };
  return (
    <article className="search-result">
      <Link {...destination} className="search-result-thumb" tabIndex={-1} aria-hidden="true">
        {item.preview && item.job_id ? (
          <img
            src={`/api/v1/document-jobs/${item.job_id}/files/${item.preview}`}
            alt=""
            loading="lazy"
            decoding="async"
          />
        ) : (
          <>
            <FileText />
            <span>{item.format.toUpperCase()}</span>
          </>
        )}
      </Link>
      <div className="search-result-copy">
        <p className="search-result-source">
          {item.kind === 'templates' ? '템플릿' : '레퍼런스'} · {item.format.toUpperCase()} · 버전{' '}
          {item.file_version}
          {item.page_label && ` · ${item.page_label}`}
        </p>
        <h2>
          <Link {...destination}>{item.title}</Link>
        </h2>
        <MatchText text={item.excerpt || item.filename} query={input.q} />
        <footer>
          <span>{item.content_match ? '본문에서 찾음' : '파일 정보에서 찾음'}</span>
          <time dateTime={new Date(item.updated_at).toISOString()}>
            {new Intl.DateTimeFormat('ko-KR').format(item.updated_at)}
          </time>
          {item.excerpt && <span className="search-filename">{item.filename}</span>}
        </footer>
      </div>
    </article>
  );
}
export function SearchPage() {
  const [params, setParams] = useUrlSearch(),
    input = searchParams(params),
    key = encodeSearch(input);
  const result = useQuery({
    queryKey: ['library-search', key],
    queryFn: ({ signal }) => findDocuments(input, signal),
    enabled: !!input.q,
    retry: false,
  });
  const navigate = (next: SearchInput) => setParams(new URLSearchParams(encodeSearch(next)));
  return (
    <main className="container workspace search-workspace">
      <title>Space | PreM</title>
      <header className="space-search-heading">
        <h1>Space</h1>
        <LibraryUpload kind={input.scope} />
      </header>
      <section className="search-page-heading" aria-label="Space 자료 찾기">
        <SearchBox
          key={input.q || params.get('name') || ''}
          initial={input.q || params.get('name') || ''}
          onSearch={(q) => navigate({ ...input, q, offset: 0 })}
        />
      </section>
      <Tabs
        value={input.scope}
        activationMode="manual"
        onValueChange={(scope) => {
          setParams((next) => {
            next.set('scope', scope);
            next.delete('offset');
            return next;
          });
        }}
      >
        <div className="space-browse-tools">
          <TabsList className="space-kind-tabs" aria-label="검색 자료 종류">
            <TabsTrigger value="all">전체</TabsTrigger>
            <TabsTrigger value="references">레퍼런스</TabsTrigger>
            <TabsTrigger value="templates">템플릿</TabsTrigger>
          </TabsList>

          <Filters key={key} input={input} apply={navigate} />
          {input.q && (
            <Button asChild variant="ghost">
              <Link to="/space" search={{ scope: input.scope }}>
                자료 목록으로
              </Link>
            </Button>
          )}
        </div>
        <TabsContent value={input.scope}>
          {!input.q ? (
            <Suspense fallback={<p role="status">자료 목록을 불러오고 있습니다.</p>}>
              <SpaceDirectory kind={input.scope} />
            </Suspense>
          ) : result.isPending ? (
            <p role="status">자료를 찾고 있습니다.</p>
          ) : result.isError ? (
            <div role="alert">
              <p>{errorMessage(result.error)}</p>
              <Button variant="secondary" onClick={() => void result.refetch()}>
                다시 시도
              </Button>
            </div>
          ) : (
            <>
              <p role="status" className="search-count">
                {result.isFetching
                  ? '결과를 갱신하고 있습니다.'
                  : `“${input.q}” 검색 결과 ${result.data.total}개`}
              </p>
              {result.data.items.length ? (
                <div className="search-results">
                  {result.data.items.map((item) => (
                    <Result key={`${item.kind}:${item.id}`} item={item} input={input} />
                  ))}
                </div>
              ) : (
                <div className="search-empty">
                  <h2>일치하는 자료가 없습니다.</h2>
                  <p>다른 표현으로 검색하거나 자료 종류·상태를 확인해 보세요.</p>
                </div>
              )}
              {result.data.total > 12 && (
                <nav className="search-pagination" aria-label="검색 결과 페이지">
                  <Button
                    variant="secondary"
                    disabled={!input.offset}
                    onClick={() => navigate({ ...input, offset: Math.max(0, input.offset - 12) })}
                  >
                    <ArrowLeft />
                    이전
                  </Button>
                  <span>
                    {Math.floor(input.offset / 12) + 1} / {Math.ceil(result.data.total / 12)}
                  </span>
                  <Button
                    variant="secondary"
                    disabled={input.offset + 12 >= result.data.total}
                    onClick={() => navigate({ ...input, offset: input.offset + 12 })}
                  >
                    다음
                    <ArrowRight />
                  </Button>
                </nav>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>
    </main>
  );
}
