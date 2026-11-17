// Purpose: Present a matched file/content with exact-version preview and original project links.
// Pattern: News-style rows, separate selection, literal-match highlighting and paged provenance.
// Usage: Results and selected-reference lists use the same canonical item projection.
// Related: shared/ui/match-text.tsx, api.ts, features/document-processing public preview.
import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { FileText, Check, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ProcessingDialog } from '@/features/document-processing';
import { errorMessage } from '@/shared/api/http';
import { getOrigins, type Origin, type RelatedItem } from './api';
import { MatchText } from '@/shared/ui/match-text';
const labels: Record<number, string> = {
  0: '자동 비교에서는 관련성이 낮음',
  1: '같은 업무 맥락',
  2: '뒷받침 자료',
  3: '재사용할 접근 방식',
  4: '차이 확인 필요',
  5: '직접 확인 필요',
};
export function ResultRow({
  project,
  item,
  query,
  disabled,
  pending,
  onSelect,
  onInspect,
  inspected,
}: {
  project: string;
  item: RelatedItem;
  query: string;
  disabled: boolean;
  pending: boolean;
  onSelect: (item: RelatedItem) => void;
  onInspect: (item: RelatedItem, button: HTMLButtonElement) => void;
  inspected: boolean;
}) {
  const [preview, setPreview] = useState<Origin | null>(null),
    [showOrigins, setShowOrigins] = useState(false);
  const previewTrigger = useRef<HTMLButtonElement>(null);
  const source = item.origins[0];
  if (!source) return null;
  return (
    <article className="related-result" data-candidate-id={item.id} data-inspected={inspected}>
      <Button
        variant="ghost"
        ref={previewTrigger}
        className="related-thumbnail"
        aria-label={`${source.filename} 미리보기`}
        disabled={!source.available}
        onClick={() => setPreview(source)}
      >
        {item.preview && source.available ? (
          <img
            src={`/api/v1/document-jobs/${source.job_id}/files/${item.preview}`}
            alt=""
            loading="lazy"
            decoding="async"
          />
        ) : (
          <FileText aria-hidden="true" />
        )}
      </Button>
      <div className="related-result-copy">
        <header>
          <span className="related-label">
            {item.relation === null ? '비교 전' : (labels[item.relation] ?? '내용 확인')}
          </span>
          <Button
            variant="ghost"
            className="related-title"
            aria-pressed={inspected}
            disabled={!source.available}
            onClick={(event) => onInspect(item, event.currentTarget)}
          >
            {source.filename}
          </Button>
        </header>
        <p className="related-source">
          {source.available ? (
            <Link to="/studio/$projectId" params={{ projectId: source.project_id }}>
              {source.project_name}
            </Link>
          ) : (
            <span>{source.project_name} · 원본에서 제거됨</span>
          )}{' '}
          · 버전 {source.file_version} · {item.page_label}{' '}
          {item.origin_count > 1 && (
            <Button variant="link" onClick={() => setShowOrigins(true)}>
              {item.project_count > 1
                ? `소속 ${item.project_count}곳 보기`
                : `등록 ${item.origin_count}건 보기`}
            </Button>
          )}
        </p>
        <MatchText text={item.excerpt} query={query} />
      </div>
      <Button
        variant={item.selected ? 'secondary' : 'ghost'}
        size="icon"
        className="related-select"
        aria-label={`${source.filename} ${item.selected ? '참고 해제' : '참고 자료로 선택'}`}
        aria-pressed={item.selected}
        disabled={pending || disabled || (!item.selected && !source.available)}
        onClick={() => onSelect(item)}
      >
        {item.selected ? <Check aria-hidden="true" /> : <Plus aria-hidden="true" />}
      </Button>
      {preview && (
        <ProcessingDialog
          item={{
            id: preview.item_id,
            kind: `project-${preview.project_id}`,
            version: preview.item_version,
            file_version: preview.file_version,
            title: preview.filename,
            job_id: preview.job_id,
            page_id: item.kind === 'block' ? item.page_id : undefined,
          }}
          returnFocus={previewTrigger.current ?? undefined}
          onClose={() => setPreview(null)}
        />
      )}
      {showOrigins && (
        <OriginDialog
          project={project}
          item={item}
          onClose={() => setShowOrigins(false)}
          onPreview={(origin) => {
            setShowOrigins(false);
            setPreview(origin);
          }}
        />
      )}
    </article>
  );
}
function OriginDialog({
  project,
  item,
  onClose,
  onPreview,
}: {
  project: string;
  item: RelatedItem;
  onClose: () => void;
  onPreview: (origin: Origin) => void;
}) {
  const moving = useRef(false);
  const [offset, setOffset] = useState(0);
  const rows = useQuery({
    queryKey: ['relations', 'origins', project, item.id, offset],
    queryFn: ({ signal }) => getOrigins(project, item.id, offset, signal),
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        onCloseAutoFocus={(e) => {
          if (moving.current) e.preventDefault();
        }}
      >
        <DialogTitle>이 자료를 사용한 프로젝트</DialogTitle>
        <DialogDescription>같은 내용도 각 프로젝트의 원본 버전으로 연결됩니다.</DialogDescription>
        {rows.isPending ? (
          <p role="status">프로젝트를 불러옵니다.</p>
        ) : rows.isError ? (
          <p role="alert">
            {errorMessage(rows.error)}{' '}
            <Button variant="secondary" onClick={() => void rows.refetch()}>
              다시 시도
            </Button>
          </p>
        ) : (
          <ul className="related-origins">
            {rows.data.map((o) => (
              <li key={o.source_version_id}>
                <Link to="/studio/$projectId" params={{ projectId: o.project_id }}>
                  {o.project_name}
                </Link>
                <span>버전 {o.file_version}</span>
                <Button
                  variant="secondary"
                  onClick={() => {
                    moving.current = true;
                    onPreview(o);
                  }}
                >
                  원본 보기
                </Button>
              </li>
            ))}
          </ul>
        )}
        <footer className="related-pagination">
          <Button variant="secondary" disabled={!offset} onClick={() => setOffset(offset - 20)}>
            이전
          </Button>
          <span>{offset / 20 + 1} 페이지</span>
          <Button
            variant="secondary"
            disabled={(rows.data?.length ?? 0) < 20}
            onClick={() => setOffset(offset + 20)}
          >
            다음
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
