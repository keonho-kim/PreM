// Purpose: Let office users inspect source slides, artwork and text as distinct reusable materials.
// Pattern: Query-owned catalog with an ordered, local multi-selection resolved against immutable source IDs.
// Usage: Space reference preview; selection review never claims to insert into a presentation.
// Related: materials-api.ts, content.tsx, reference-materials.css.
import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Layers, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { errorMessage } from '@/shared/api/http';
import { MaterialCard } from './material-card';
import { SlideGroups } from './slide-groups';
import { getMaterials, resolveMaterials, materialKeys, type Material } from './materials-api';
import './reference-materials.css';
export function ReferenceMaterials({
  job,
  groupSlides = false,
}: {
  job: string;
  groupSlides?: boolean;
}) {
  const [kind, setKind] = useState('all'),
    [draft, setDraft] = useState(''),
    [query, setQuery] = useState(''),
    [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string[]>([]),
    [review, setReview] = useState<Material[] | null>(null);
  const [error, setError] = useState(''),
    [pending, setPending] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const result = useInfiniteQuery({
    queryKey: materialKeys.list(job, kind, query, offset),
    initialPageParam: offset,
    queryFn: ({ signal, pageParam }) => getMaterials(job, kind, query, pageParam, signal),
    getNextPageParam: (last, _pages, start) =>
      start + last.items.length < last.total && last.items.length
        ? start + last.items.length
        : undefined,
  });
  const inspect = async () => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setPending(true);
    setError('');
    try {
      const data = await resolveMaterials(job, selected, request.signal);
      if (!request.signal.aborted) setReview(data.items);
    } catch (e) {
      if (!request.signal.aborted) setError(errorMessage(e));
    } finally {
      if (!request.signal.aborted) setPending(false);
    }
  };
  const toggle = (id: string) =>
    setSelected((ids) =>
      ids.includes(id) ? ids.filter((value) => value !== id) : ids.length < 50 ? [...ids, id] : ids,
    );
  const catalog = result.data?.pages[0];
  const items = review ?? result.data?.pages.flatMap((p) => p.items) ?? [];
  function cards(parts: Material[], grouped: boolean) {
    return parts.map((item, index) => (
      <MaterialCard
        key={item.id}
        job={job}
        item={item}
        grouped={grouped}
        reviewNumber={review ? index + 1 : undefined}
        selected={selected.includes(item.id)}
        disabled={pending || (!selected.includes(item.id) && selected.length >= 50)}
        onSelect={() => toggle(item.id)}
      />
    ));
  }
  return (
    <section aria-label="PPT에 쓸 자료" className="reference-materials">
      <p className="field-hint">
        장표 전체와 안에 담긴 그림·글을 구분해 확인합니다. 여러 항목을 선택하면 선택한 순서로 모아볼
        수 있습니다.
      </p>
      {review ? (
        <div className="material-toolbar">
          <Button variant="ghost" onClick={() => setReview(null)}>
            <ArrowLeft aria-hidden="true" />
            전체 자료로 돌아가기
          </Button>
          <strong>선택한 자료 {review.length}개</strong>
        </div>
      ) : (
        <>
          <Label htmlFor="material-kind">자료 종류</Label>
          <Select
            value={kind}
            onValueChange={(value) => {
              setKind(value);
              setOffset(0);
            }}
          >
            <SelectTrigger id="material-kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체</SelectItem>
              <SelectItem value="slides">장표·페이지</SelectItem>
              <SelectItem value="visual">그림</SelectItem>
              <SelectItem value="text">글·표</SelectItem>
            </SelectContent>
          </Select>
          <form
            className="material-search"
            onSubmit={(event) => {
              event.preventDefault();
              setQuery(draft);
              setOffset(0);
            }}
          >
            <Label htmlFor="material-search">자료에서 찾기</Label>
            <div>
              <Input
                id="material-search"
                maxLength={80}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
              <Button type="submit" variant="secondary">
                검색
              </Button>
            </div>
          </form>
          <div className="material-toolbar">
            <span>{selected.length}개 선택 · 최대 50개</span>
            <Button
              variant="secondary"
              disabled={!selected.length || pending}
              onClick={() => void inspect()}
            >
              <Layers aria-hidden="true" />
              {pending ? '불러오는 중…' : '선택한 자료 보기'}
            </Button>
            {selected.length > 0 && (
              <Button variant="ghost" disabled={pending} onClick={() => setSelected([])}>
                선택 해제
              </Button>
            )}
          </div>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {!review && result.isPending ? (
        <p role="status">자료를 불러옵니다.</p>
      ) : !review && result.isError && !catalog ? (
        <div role="status">
          <p>{errorMessage(result.error)}</p>
          <Button variant="secondary" onClick={() => void result.refetch()}>
            다시 시도
          </Button>
        </div>
      ) : !review && !catalog?.ready ? (
        <p>
          이 자료는 아직 재사용 자료가 준비되지 않았습니다. 위의 ‘재사용 자료 준비’를 눌러 주세요.
        </p>
      ) : !items.length ? (
        <p>이 조건에 맞는 자료가 없습니다.</p>
      ) : groupSlides && !review ? (
        <div className="material-slide-groups">
          <SlideGroups items={items} label={(item) => item.page_label}>
            {(group) => <div className="material-gallery">{cards(group, true)}</div>}
          </SlideGroups>
        </div>
      ) : (
        <div className={`material-gallery${review ? ' material-review' : ''}`}>
          {cards(items, false)}
        </div>
      )}
      {!review && groupSlides && result.hasNextPage && (
        <div className="processing-pagination">
          {result.isFetchNextPageError && (
            <span role="alert">다음 자료를 불러오지 못했습니다.</span>
          )}
          <Button
            variant="secondary"
            disabled={result.isFetching}
            onClick={() => void result.fetchNextPage()}
          >
            {result.isFetchNextPageError ? '다시 시도' : '자료 더 보기'}
          </Button>
        </div>
      )}
      {!review && !groupSlides && (
        <div className="processing-pagination">
          <Button
            variant="secondary"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - 50))}
          >
            이전 자료
          </Button>
          <span>
            {Math.floor(offset / 50) + 1} / {Math.max(1, Math.ceil((catalog?.total ?? 0) / 50))}
          </span>
          <Button
            variant="secondary"
            disabled={offset + 50 >= (catalog?.total ?? 0)}
            onClick={() => setOffset(offset + 50)}
          >
            다음 자료
          </Button>
        </div>
      )}
    </section>
  );
}
