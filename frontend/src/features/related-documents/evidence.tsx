// Purpose: Review one selected candidate beside the compact evidence list.
// Pattern: Bounded source/compare tabs with exact-version previews and explicit selection.
// Usage: RelatedResults owns the active candidate and persistence mutation.
// Related: api.ts, result-row.tsx, features/document-processing/.
import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Plus, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ProcessingDialog } from '@/features/document-processing';
import { errorMessage } from '@/shared/api/http';
import { getEvidence, type RelatedItem } from './api';
export function Evidence({
  project,
  item,
  disabled,
  onSelect,
}: {
  project: string;
  item: RelatedItem;
  disabled: boolean;
  onSelect: (item: RelatedItem) => void;
}) {
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof getEvidence>>[number] | null>(
    null,
  );
  const trigger = useRef<HTMLButtonElement | null>(null);
  const result = useQuery({
    queryKey: ['relations', 'evidence', project, item.id, item.evidence_version ?? 0],
    queryFn: ({ signal }) => getEvidence(project, item.id, signal),
  });
  return (
    <>
      <header className="evidence-reader-heading">
        <p className="field-hint">근거 검토</p>
        <h3>{item.origins[0]?.filename}</h3>
        <Button
          variant={item.selected ? 'secondary' : 'default'}
          disabled={disabled}
          onClick={() => onSelect(item)}
        >
          {item.selected ? <Check aria-hidden="true" /> : <Plus aria-hidden="true" />}
          {item.selected ? '선택한 근거에서 빼기' : '근거로 선택'}
        </Button>
      </header>
      <Tabs defaultValue="source" activationMode="manual">
        <TabsList aria-label="근거 읽기">
          <TabsTrigger value="source">원문</TabsTrigger>
          <TabsTrigger value="comparison">비교 자료</TabsTrigger>
        </TabsList>
        {(['source', 'comparison'] as const).map((kind) => (
          <TabsContent key={kind} value={kind}>
            {result.isPending ? (
              <p role="status">원문을 불러옵니다.</p>
            ) : result.isError ? (
              <p role="alert">
                {errorMessage(result.error)}{' '}
                <Button variant="secondary" onClick={() => void result.refetch()}>
                  다시 시도
                </Button>
              </p>
            ) : (
              <>
                {!result.data.some((r) => r.comparison === (kind === 'comparison')) && (
                  <p className="field-hint">
                    {kind === 'comparison'
                      ? '함께 비교한 자료가 없습니다.'
                      : '표시할 원문이 없습니다.'}
                  </p>
                )}
                <ul className="evidence-passages">
                  {result.data
                    .filter((r) => r.comparison === (kind === 'comparison'))
                    .map((read) => (
                      <li key={read.block_id}>
                        <p className="field-hint">
                          {read.origin.filename} · {read.page_label} · 버전{' '}
                          {read.origin.file_version}
                        </p>
                        <p>
                          {read.text}
                          {read.truncated && '…'}
                        </p>
                        <Button
                          variant="ghost"
                          onClick={(e) => {
                            trigger.current = e.currentTarget;
                            setPreview(read);
                          }}
                        >
                          <ExternalLink aria-hidden="true" />
                          {read.truncated ? '원문 전체 보기' : '원문 보기'}
                        </Button>
                      </li>
                    ))}
                </ul>
              </>
            )}
          </TabsContent>
        ))}
      </Tabs>
      {preview && (
        <ProcessingDialog
          item={{
            id: preview.origin.item_id,
            kind: `project-${preview.origin.project_id}`,
            version: preview.origin.item_version,
            file_version: preview.origin.file_version,
            title: preview.origin.filename,
            job_id: preview.origin.job_id,
            page_id: preview.page_id,
          }}
          returnFocus={trigger.current ?? undefined}
          onClose={() => setPreview(null)}
        />
      )}
    </>
  );
}
