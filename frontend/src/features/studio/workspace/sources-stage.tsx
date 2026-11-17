// Purpose: Render source discovery, pagination and explicit source confirmation.
// Pattern: Feature-owned queries and view composition have separate owners.
// Usage: Studio workspace internal module.
// Related: index.tsx, ../source-card.tsx.
import { Plus, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/shared/api/http';
import type { Asset } from '@/features/space';
import { SourceCard, type SourceAction } from '../source-card';
import type { WorkspaceData } from './use-workspace-data';
type Props = {
  visible: boolean;
  editable: boolean;
  offset: number;
  files: WorkspaceData['files'];
  review: WorkspaceData['review'];
  confirm: { isError: boolean; error: unknown; isPending: boolean; mutate: () => void };
  onOffset: (offset: number) => void;
  onUpload: () => void;
  onBlank: () => void;
  onAction: (action: SourceAction, item: Asset, trigger: HTMLElement) => void;
};
export function SourcesStage({
  visible,
  editable,
  offset,
  files,
  review,
  confirm,
  onOffset,
  onUpload,
  onBlank,
  onAction,
}: Props) {
  return (
    <section hidden={!visible} aria-label="프로젝트 원본">
      <header className="studio-section-heading">
        <div>
          <h2>발표의 바탕이 될 문서</h2>
          <p className="muted">이 프로젝트에 필요한 원본을 추가하고 내용을 확인하세요.</p>
        </div>
        <Button disabled={!editable} onClick={onUpload}>
          <Plus aria-hidden="true" />
          문서 추가
        </Button>
      </header>
      {files.isPending ? (
        <p role="status">원본 목록을 불러옵니다.</p>
      ) : files.isError ? (
        <p role="alert">
          {errorMessage(files.error)}{' '}
          <Button variant="secondary" onClick={() => void files.refetch()}>
            다시 시도
          </Button>
        </p>
      ) : files.data.items.length ? (
        <div className="studio-source-grid">
          {files.data.items.map((item) => (
            <SourceCard key={item.id} item={item} editable={editable} onAction={onAction} />
          ))}
        </div>
      ) : (
        <div className="studio-empty">
          <h3>첫 원본 문서를 추가하세요</h3>
          <Button variant="secondary" onClick={onBlank}>
            빈 장표로 직접 작성
          </Button>
          <p>PDF · HWP · HWPX · DOCX · PPTX · XLSX · HTML · Markdown을 사용할 수 있습니다.</p>
          <p className="muted">공용 레퍼런스와 템플릿은 Space에서 관리합니다.</p>
        </div>
      )}
      {!!files.data && files.data.total > 12 && (
        <div className="studio-page-controls">
          <Button variant="secondary" disabled={!offset} onClick={() => onOffset(offset - 12)}>
            이전
          </Button>
          <span>
            {offset / 12 + 1} / {Math.ceil(files.data.total / 12)}
          </span>
          <Button
            variant="secondary"
            disabled={offset + 12 >= files.data.total}
            onClick={() => onOffset(offset + 12)}
          >
            다음
          </Button>
        </div>
      )}
      <footer className="studio-review">
        <div>
          <strong>
            {review.data?.confirmed ? '원본 확인 완료' : `${review.data?.count ?? 0}개 원본`}
          </strong>
          <p className="muted">문서를 추가하거나 교체하면 다시 확인해야 합니다.</p>
          {confirm.isError && <p role="alert">{errorMessage(confirm.error)}</p>}
        </div>
        <Button
          disabled={!editable || !review.data?.ready || confirm.isPending || review.isError}
          onClick={() => confirm.mutate()}
        >
          {confirm.isPending ? '확인 중…' : '원본 확인하고 계속'}
          <ArrowRight aria-hidden="true" />
        </Button>
      </footer>
    </section>
  );
}
