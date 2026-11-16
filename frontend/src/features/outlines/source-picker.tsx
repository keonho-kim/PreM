// Purpose: Find canonical source passages only when the author asks to add content.
// Pattern: Owned search and pagination inside the existing shadcn dialog primitive.
// Usage: ContentMapping supplies current links and draft-only toggle commands.
// Related: mapping.tsx, api.ts, outlines.css.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Check, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { errorMessage } from '@/shared/api/http';
import { getBlocks, type SourceBlock } from './api';
export function SourcePicker({
  project,
  returnFocus,
  revision,
  linked,
  onToggle,
  onPreview,
  onClose,
}: {
  project: string;
  returnFocus: HTMLButtonElement | null;
  revision?: string;
  linked: string[];
  onToggle: (id: string) => void;
  onPreview: (block: SourceBlock) => void;
  onClose: () => void;
}) {
  const [draftQuery, setDraftQuery] = useState('');
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const available = useQuery({
    queryKey: ['outlines', project, 'source', revision, query, offset],
    queryFn: ({ signal }) => getBlocks(project, revision, query, offset, undefined, signal),
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="outline-picker-dialog"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus?.focus();
        }}
      >
        <DialogTitle>내용 담기</DialogTitle>
        <DialogDescription>
          이 목차에 사용할 원문을 고르세요. 같은 내용을 여러 목차에 사용할 수 있습니다.
        </DialogDescription>
        <form
          className="outline-block-search"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(draftQuery);
            setOffset(0);
          }}
        >
          <Label className="sr-only" htmlFor="outline-block-query">
            원문 내용 검색
          </Label>
          <Input
            id="outline-block-query"
            type="search"
            value={draftQuery}
            maxLength={120}
            onChange={(e) => setDraftQuery(e.target.value)}
            placeholder="문서 내용에서 찾기"
          />
          <Button type="submit" variant="secondary">
            <Search aria-hidden="true" />
            찾기
          </Button>
        </form>
        <div className="outline-picker-results">
          {available.isPending ? (
            <p role="status">원문을 불러옵니다.</p>
          ) : available.isError ? (
            <p role="alert">
              {errorMessage(available.error)}{' '}
              <Button variant="secondary" onClick={() => void available.refetch()}>
                다시 시도
              </Button>
            </p>
          ) : (
            <>
              {available.data.items.map((b) => (
                <article key={b.id} data-block-id={b.id} className="outline-source-block">
                  <p className="field-hint">
                    {b.filename} · {b.page_label} · 버전 {b.file_version}
                  </p>
                  <button
                    type="button"
                    className="outline-passage"
                    aria-label={`${b.filename} ${b.page_label} 근거 확인`}
                    onClick={() => {
                      onPreview(b);
                      onClose();
                    }}
                  >
                    <span>{b.text}</span>
                  </button>
                  <Button
                    variant="secondary"
                    aria-pressed={linked.includes(b.id)}
                    onClick={() => onToggle(b.id)}
                  >
                    {linked.includes(b.id) ? (
                      <Check aria-hidden="true" />
                    ) : (
                      <Plus aria-hidden="true" />
                    )}
                    {linked.includes(b.id) ? '연결 해제' : '이 목차에 연결'}
                  </Button>
                </article>
              ))}
              {!available.data.items.length && <p>일치하는 원문이 없습니다.</p>}
            </>
          )}
        </div>
        <footer className="outline-pager">
          <Button
            variant="ghost"
            disabled={!offset}
            onClick={() => setOffset(Math.max(0, offset - 20))}
          >
            이전 원문
          </Button>
          <span>{offset / 20 + 1}</span>
          <Button
            variant="ghost"
            disabled={!available.data || offset + 20 >= available.data.total}
            onClick={() => setOffset(offset + 20)}
          >
            다음 원문
          </Button>
          <Button variant="secondary" onClick={onClose}>
            선택 마치기
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
