// Purpose: Let users inspect canonical evidence behind a generated slide.
// Pattern: Active inspector tab with exact-version previews and explicit availability states.
// Usage: DeckPreview passes the pinned run/slide identity; source bodies remain server-owned.
// Related: api.ts, features/document-processing/.
import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { ProcessingDialog } from '@/features/document-processing';
import { errorMessage } from '@/shared/api/http';
import { getCitations, type Citation } from './api';
export function SlideEvidence({
  project,
  run,
  slide,
  count,
  active,
}: {
  project: string;
  run: string;
  slide: string;
  count: number;
  active: boolean;
}) {
  const [preview, setPreview] = useState<Citation | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const rows = useQuery({
    queryKey: ['presentations', project, run, slide, 'evidence'],
    queryFn: ({ signal }) => getCitations(project, run, slide, signal),
    enabled: active,
  });
  return (
    <>
      <p className="field-hint">연결된 원문 {count}곳</p>
      {rows.isPending ? (
        <p role="status">근거를 불러옵니다.</p>
      ) : rows.isError ? (
        <p role="alert">
          {errorMessage(rows.error)}{' '}
          <Button variant="secondary" onClick={() => void rows.refetch()}>
            다시 시도
          </Button>
        </p>
      ) : (
        <ul className="presentation-citations">
          {rows.data.map((c) => (
            <li key={c.block_id}>
              <strong>
                {c.filename} · {c.page_label}
              </strong>
              <p>{c.text}</p>
              <Button
                variant="secondary"
                disabled={!c.available}
                onClick={(e) => {
                  trigger.current = e.currentTarget;
                  setPreview(c);
                }}
              >
                {c.available ? '원문 보기' : '원본에서 제거된 자료'}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {active && preview && (
        <ProcessingDialog
          item={{
            id: preview.item_id,
            kind: `project-${preview.project_id}`,
            version: preview.item_version,
            file_version: preview.file_version,
            title: preview.filename,
            job_id: preview.job_id,
            page_id: preview.page_id,
          }}
          returnFocus={trigger.current ?? undefined}
          onClose={() => setPreview(null)}
        />
      )}
    </>
  );
}
