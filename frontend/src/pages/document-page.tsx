// Purpose: Open a search result as a full document page with a stable return destination.
// Pattern: Page composes Space metadata and document content through public feature facades.
// Usage: /home/space/documents/:kind/:id?job=...&page=...&back=...; no modal or search form.
// Related: features/search/, features/document-processing/, features/space/.
import { useEffect, useRef } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { useUrlSearch } from '@/shared/routing/search';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ProcessingView } from '@/features/document-processing';
import { getAsset } from '@/features/space';
import { errorMessage } from '@/shared/api/http';
import './document-page.css';
export function DocumentPage() {
  const { kind, id } = useParams({ strict: false }),
    [params] = useUrlSearch();
  const job = params.get('job') ?? undefined,
    page = params.get('page') ?? undefined;
  const valid =
    (kind === 'references' || kind === 'templates') &&
    z.uuid().safeParse(id).success &&
    (!job || z.uuid().safeParse(job).success) &&
    (!page || z.uuid().safeParse(page).success);
  const resource = useQuery({
    queryKey: ['space', 'document-page', kind, id],
    queryFn: ({ signal }) => getAsset(kind as 'references' | 'templates', id ?? '', signal),
    enabled: valid,
    retry: false,
  });
  const main = useRef<HTMLElement>(null);
  useEffect(() => {
    if (resource.data?.id) main.current?.querySelector<HTMLElement>('h1')?.focus();
  }, [resource.data?.id]);
  const back = params.get('back') ?? '/space';
  const destination = /^\/(search|space)(\?|$)/.test(back)
    ? back.replace(/^\/search(?=\?|$)/, '/space')
    : '/space';
  return (
    <main ref={main} className="container workspace document-workspace">
      <title>{resource.data?.title ?? '자료'} | PreM</title>
      <Button variant="ghost" asChild>
        <Link
          to="/space"
          search={Object.fromEntries(new URLSearchParams(destination.split('?')[1] ?? ''))}
        >
          <ArrowLeft aria-hidden="true" />
          검색 결과로
        </Link>
      </Button>
      {!valid ? (
        <p role="alert">자료 주소를 확인해 주세요.</p>
      ) : resource.isPending ? (
        <p role="status">자료를 불러옵니다.</p>
      ) : resource.isError ? (
        <div role="alert">
          <p>{errorMessage(resource.error)}</p>
          <Button variant="secondary" onClick={() => void resource.refetch()}>
            다시 시도
          </Button>
        </div>
      ) : (
        <ProcessingView
          key={`${id}:${job ?? 'current'}:${page ?? 'all'}`}
          fullPage
          item={{ ...resource.data, job_id: job, page_id: page }}
        />
      )}
    </main>
  );
}
