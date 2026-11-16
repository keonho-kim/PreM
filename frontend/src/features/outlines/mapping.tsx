// Purpose: Review the chosen section's content alongside its canonical source evidence.
// Pattern: One section selection, on-demand source picking and version-pinned previews.
// Usage: OutlineEditor owns assignments; this view owns only browsing and dialog state.
// Related: source-picker.tsx, api.ts, features/document-processing facade, outlines.css.
import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, X, ExternalLink, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ProcessingDialog } from '@/features/document-processing';
import { errorMessage } from '@/shared/api/http';
import { getBlocks, type Draft, type SourceBlock } from './api';
import { SourcePicker } from './source-picker';
export function ContentMapping({
  project,
  revision,
  draft,
  nodeId,
  disabled,
  onChange,
  onEdit,
}: {
  project: string;
  revision?: string;
  draft: Draft;
  nodeId: string;
  disabled: boolean;
  onChange: (d: Draft) => void;
  onEdit?: (trigger: HTMLButtonElement) => void;
}) {
  const addTrigger = useRef<HTMLButtonElement | null>(null);
  const [picking, setPicking] = useState(false);
  const [selectedOffset, setSelectedOffset] = useState(0);
  const [focused, setFocused] = useState<SourceBlock | null>(null);
  const [preview, setPreview] = useState<SourceBlock | null>(null);
  const linked = draft.assignments.filter((a) => a.node_id === nodeId).map((a) => a.block_id);
  const offset = Math.min(selectedOffset, Math.max(0, Math.ceil(linked.length / 20) - 1) * 20);
  const ids = linked.slice(offset, offset + 20);
  const selected = useQuery({
    queryKey: ['outlines', project, 'selected', revision, ids],
    queryFn: ({ signal }) => getBlocks(project, revision, '', 0, ids, signal),
    enabled: ids.length > 0,
  });
  const source = focused ?? selected.data?.items[0];
  const node = draft.nodes.find((n) => n.id === nodeId);
  const toggle = (block: string) =>
    onChange({
      ...draft,
      assignments: linked.includes(block)
        ? draft.assignments.filter((a) => !(a.node_id === nodeId && a.block_id === block))
        : [...draft.assignments, { node_id: nodeId, block_id: block }].sort((a, b) => {
            const left = `${a.node_id}:${a.block_id}`,
              right = `${b.node_id}:${b.block_id}`;
            return left < right ? -1 : left > right ? 1 : 0;
          }),
    });
  return (
    <div className="outline-mapping">
      <section aria-label="사용할 내용" className="outline-linked">
        <header className="outline-linked-heading">
          <div>
            <h3>{node?.title || '제목 없음'}</h3>
            {node?.description && <p className="muted">{node.description}</p>}
          </div>
          {onEdit && (
            <Button
              variant="secondary"
              disabled={disabled}
              onClick={(event) => onEdit(event.currentTarget)}
            >
              <Pencil aria-hidden="true" />
              제목 수정
            </Button>
          )}
        </header>
        {/* biome-ignore lint/a11y/noNoninteractiveTabindex: Named content viewport supports keyboard scrolling. */}
        <section className="outline-linked-list" aria-label="연결된 내용" tabIndex={0}>
          {!linked.length ? (
            <div className="outline-empty">
              <h4>이 목차에 사용할 내용을 담아보세요</h4>
              <p className="muted">원문에서 내용을 고르면 옆에서 근거를 확인할 수 있습니다.</p>
            </div>
          ) : selected.isPending ? (
            <p role="status">연결 내용을 불러옵니다.</p>
          ) : selected.isError ? (
            <p role="alert">
              {errorMessage(selected.error)}{' '}
              <Button variant="secondary" onClick={() => void selected.refetch()}>
                다시 시도
              </Button>
            </p>
          ) : (
            selected.data?.items.map((b) => (
              <article
                key={b.id}
                data-block-id={b.id}
                className="outline-source-block"
                data-active={source?.id === b.id}
              >
                <header>
                  <span>
                    {b.filename} · {b.page_label}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`${b.filename} ${b.page_label} 연결 해제`}
                    disabled={disabled}
                    onClick={() => {
                      toggle(b.id);
                      setFocused(null);
                    }}
                  >
                    <X />
                  </Button>
                </header>
                <button
                  type="button"
                  className="outline-passage"
                  aria-pressed={source?.id === b.id}
                  onClick={() => setFocused(b)}
                >
                  <span>{b.text}</span>
                </button>
              </article>
            ))
          )}
        </section>
        <div className="outline-linked-actions">
          <Button
            variant="secondary"
            disabled={disabled}
            ref={addTrigger}
            onClick={() => setPicking(true)}
          >
            <Plus aria-hidden="true" />
            내용 담기
          </Button>
          {linked.length > 20 && (
            <div className="outline-pager">
              <Button
                variant="ghost"
                disabled={!offset}
                onClick={() => {
                  setSelectedOffset(offset - 20);
                  setFocused(null);
                }}
              >
                이전 연결
              </Button>
              <span>{offset / 20 + 1}</span>
              <Button
                variant="ghost"
                disabled={offset + 20 >= linked.length}
                onClick={() => {
                  setSelectedOffset(offset + 20);
                  setFocused(null);
                }}
              >
                다음 연결
              </Button>
            </div>
          )}
        </div>
      </section>
      <aside className="outline-source-paper" aria-label="원문 근거">
        <h3>원문 근거</h3>
        {source ? (
          <>
            {/* biome-ignore lint/a11y/noNoninteractiveTabindex: Named source viewport supports keyboard scrolling. */}
            <section className="outline-source-reading" aria-label="선택한 원문" tabIndex={0}>
              {source.preview && (
                <img
                  loading="lazy"
                  src={`/api/v1/document-jobs/${source.job_id}/files/${source.preview}`}
                  alt="선택한 원문 이미지"
                />
              )}
              <p>{source.text}</p>
            </section>
            <footer>
              <p className="field-hint">
                {source.filename} · {source.page_label} · 버전 {source.file_version}
              </p>
              <Button variant="ghost" onClick={() => setPreview(source)}>
                <ExternalLink aria-hidden="true" />
                원문 보기
              </Button>
            </footer>
          </>
        ) : (
          <p className="muted">내용을 선택하면 해당 원문이 여기에 표시됩니다.</p>
        )}
      </aside>
      {picking && !disabled && (
        <SourcePicker
          returnFocus={addTrigger.current}
          project={project}
          revision={revision}
          linked={linked}
          onToggle={toggle}
          onPreview={setFocused}
          onClose={() => setPicking(false)}
        />
      )}
      {preview && (
        <ProcessingDialog
          item={{
            id: preview.item_id,
            kind: `project-${project}`,
            version: 1,
            file_version: preview.file_version,
            title: preview.filename,
            job_id: preview.job_id,
            page_id: preview.page_id,
          }}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}
