// Purpose: Browse canonical extracted blocks and lazily loaded original page previews.
// Pattern: Server paging/filtering, safe React text and separate preview/selection controls.
// Usage: ProcessingDialog supplies a fixed job revision; no source HTML is executed.
// Related: api.ts, processing.css, status.tsx.
import { SourceOutline } from './source-outline';
import { ReferenceMaterials } from './reference-materials';
import { ExtractedTable } from './extracted-table';
import { useState } from 'react';
import { SlideGroups } from './slide-groups';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { errorMessage } from '@/shared/api/http';
import { getBlocks, fileUrl, processingKeys, type Detail } from './api';
export function ExtractedContent({
  detail,
  initialPage,
  searchable = true,
}: {
  detail: Detail;
  initialPage?: string;
  searchable?: boolean;
}) {
  const source = detail.job.kind.startsWith('project-');
  const [page, setPage] = useState(initialPage ?? ''),
    [query, setQuery] = useState(''),
    [draft, setDraft] = useState(''),
    [offset, setOffset] = useState(0),
    [tab, setTab] = useState(
      initialPage
        ? 'content'
        : source && !detail.warnings.includes('MARKDOWN_PASSIVE_RESOURCES')
          ? 'pages'
          : detail.page_mode === 'slide' && detail.reuse_ready
            ? 'materials'
            : 'content',
    );
  const groupSlides = !source && detail.page_mode === 'slide';
  const result = useInfiniteQuery({
    queryKey: processingKeys.blocks(detail.job.id, page, query, offset),
    initialPageParam: offset,
    queryFn: ({ signal, pageParam }) => getBlocks(detail.job.id, page, query, pageParam, signal),
    getNextPageParam: (last, _pages, start) => (last.length === 50 ? start + 50 : undefined),
    enabled: tab === 'content',
    refetchInterval: detail.job.status === 'classifying' ? 2000 : false,
  });
  const blocks = result.data?.pages.flat() ?? [];
  const pageLabels = new Map(detail.pages.map((p) => [p.id, p.label]));
  const renderBlock = (b: (typeof blocks)[number]) => (
    <article key={b.id} className="processing-block">
      {(!groupSlides || b.is_table_of_contents === 1) && (
        <header>
          <span>
            {!groupSlides && `${pageLabels.get(b.page_id) ?? '원본 위치 미상'} · `}
            {b.kind === 'table'
              ? '표'
              : b.kind === 'image'
                ? '이미지'
                : b.kind === 'heading'
                  ? '제목'
                  : b.kind === 'code'
                    ? '코드'
                    : b.kind === 'list'
                      ? '목록'
                      : '문단'}
          </span>
          {b.is_table_of_contents === 1 && <span>목차</span>}
        </header>
      )}
      {b.image ? (
        <img loading="lazy" src={fileUrl(detail.job.id, b.image)} alt={b.text} />
      ) : b.kind === 'table' ? (
        <ExtractedTable text={b.text} attributes={b.attributes} />
      ) : (
        <pre>{b.text}</pre>
      )}
    </article>
  );
  return (
    <Tabs value={tab} onValueChange={setTab} className="processing-tabs">
      <TabsList aria-label="자료 보기">
        {!source && <TabsTrigger value="materials">PPT에 쓸 자료</TabsTrigger>}
        <TabsTrigger value="content">내용</TabsTrigger>
        <TabsTrigger value="pages">원본 페이지</TabsTrigger>
      </TabsList>
      <TabsContent value="materials">
        {detail.page_mode !== 'slide' && detail.warnings.includes('IMAGE_PREVIEW_UNAVAILABLE') && (
          <p role="status">
            일부 이미지는 개별 자료로 준비하지 못했습니다. 원본 파일에서 확인해 주세요.
          </p>
        )}
        <ReferenceMaterials job={detail.job.id} groupSlides={groupSlides} />
      </TabsContent>
      <TabsContent value="content">
        {detail.warnings.includes('MARKDOWN_PASSIVE_RESOURCES') && (
          <p className="field-hint">
            Markdown은 텍스트로 표시합니다. 링크나 이미지의 연결 대상은 불러오지 않습니다.
          </p>
        )}
        {searchable && (
          <form
            className="processing-search"
            onSubmit={(e) => {
              e.preventDefault();
              setQuery(draft);
              setOffset(0);
            }}
          >
            <Label htmlFor="block-search">문서 내용 검색</Label>
            <Input
              id="block-search"
              value={draft}
              maxLength={80}
              onChange={(e) => setDraft(e.target.value)}
            />
            <Button type="submit" variant="secondary">
              검색
            </Button>
          </form>
        )}
        <div className="processing-page-filter">
          <Label htmlFor="processing-page">영역 선택</Label>
          <Select
            value={page || 'all'}
            onValueChange={(value) => {
              setPage(value === 'all' ? '' : value);
              setOffset(0);
            }}
          >
            <SelectTrigger id="processing-page">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체 영역</SelectItem>
              {detail.pages.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.label}
                  {p.alignment?.section && ` · ${p.alignment.section}`} · {p.block_count}개 항목
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {result.isPending ? (
          <p role="status">내용을 불러옵니다.</p>
        ) : result.isError && !result.data ? (
          <p role="status">
            {errorMessage(result.error)}{' '}
            <Button variant="secondary" onClick={() => void result.refetch()}>
              다시 시도
            </Button>
          </p>
        ) : !blocks.length ? (
          <p>표시할 내용이 없습니다.</p>
        ) : (
          <div className="processing-blocks">
            {groupSlides ? (
              <SlideGroups
                items={blocks}
                label={(b) => pageLabels.get(b.page_id) ?? '원본 위치 미상'}
              >
                {(parts) => parts.map(renderBlock)}
              </SlideGroups>
            ) : (
              blocks.map(renderBlock)
            )}
          </div>
        )}
        {groupSlides ? (
          result.hasNextPage && (
            <div className="processing-pagination">
              {result.isFetchNextPageError && (
                <span role="alert">다음 내용을 불러오지 못했습니다.</span>
              )}
              <Button
                variant="secondary"
                disabled={result.isFetching}
                onClick={() => void result.fetchNextPage()}
              >
                {result.isFetchNextPageError ? '다시 시도' : '내용 더 보기'}
              </Button>
            </div>
          )
        ) : (
          <div className="processing-pagination">
            <Button
              variant="secondary"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - 50))}
            >
              이전
            </Button>
            <span>{Math.floor(offset / 50) + 1} 페이지</span>
            <Button
              variant="secondary"
              disabled={blocks.length < 50}
              onClick={() => setOffset(offset + 50)}
            >
              다음
            </Button>
          </div>
        )}
      </TabsContent>
      <TabsContent value="pages">
        <SourceOutline entries={detail.source_outline} />
        <p className="field-hint">
          {detail.page_mode === 'section'
            ? '문서 구성에 따라 원본과 페이지 구분이 다를 수 있습니다.'
            : detail.page_mode === 'unpaginated'
              ? '이 문서는 고정된 페이지 경계가 없습니다.'
              : '원본 페이지·슬라이드·시트 위치입니다.'}
        </p>
        <div className="processing-pages">
          {detail.pages.map((p) => (
            <article key={p.id}>
              <div className="processing-page-preview">
                {p.preview ? (
                  <img
                    loading="lazy"
                    decoding="async"
                    src={fileUrl(detail.job.id, p.preview)}
                    alt={`${p.label} 원본 미리보기`}
                  />
                ) : (
                  <span>이 형식의 원본 미리보기는 제공되지 않습니다.</span>
                )}
              </div>
              {p.alignment && (
                <p className="field-hint" id={`page-chapter-${p.id}`}>
                  {p.alignment.preceding_section && `${p.alignment.preceding_section} → `}
                  {p.alignment.section && `${p.alignment.section} · `}
                  {
                    {
                      start: '장 시작',
                      body: '본문',
                      contents: '목차',
                      divider: '간지',
                      divider_start: '간지 · 장 시작',
                      range: '장 경계 기준',
                      unknown: '대목차 미확정',
                    }[p.alignment.role]
                  }
                  {p.alignment.printed_page != null &&
                    ` · 인쇄 쪽수 추정 ${p.alignment.printed_page}쪽`}
                </p>
              )}
              <Button
                variant="ghost"
                aria-describedby={p.alignment ? `page-chapter-${p.id}` : undefined}
                onClick={() => {
                  setPage(p.id);
                  setOffset(0);
                  setTab('content');
                }}
              >
                {p.label} · 내용 보기
              </Button>
            </article>
          ))}
        </div>
      </TabsContent>
    </Tabs>
  );
}
