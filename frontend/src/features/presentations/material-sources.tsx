// Purpose: Show inserted reference lineage and reopen the exact source version beside the slide.
// Pattern: Read-only canonical projection; preview and selection remain separate actions.
// Usage: Reference inspector on generated/edited slides; deleted originals preserve saved decks.
// Related: references HTTP adapter, material-insertion.tsx, ProcessingDialog.
import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { ProcessingDialog, fileUrl } from '@/features/document-processing';
import { request, errorMessage } from '@/shared/api/http';
const source = z.object({
  id: z.uuid(),
  job_id: z.uuid(),
  item_id: z.uuid(),
  source_kind: z.union([
    z.enum(['references', 'templates']),
    z.templateLiteral(['project-', z.uuid()]),
  ]),
  item_version: z.number(),
  file_version: z.number(),
  page_id: z.uuid(),
  title: z.string(),
  kind: z.string(),
  preview: z.string().nullable(),
  available: z.boolean(),
});
type Source = z.infer<typeof source>;
export function MaterialSources({
  project,
  run,
  slide,
  active,
}: {
  project: string;
  run: string;
  slide: string;
  active: boolean;
}) {
  const [preview, setPreview] = useState<Source | null>(null),
    trigger = useRef<HTMLButtonElement | null>(null);
  const rows = useQuery({
    queryKey: ['presentations', project, run, slide, 'materials'],
    queryFn: ({ signal }) =>
      request(
        `/api/v1/projects/${project}/presentations/${run}/slides/${slide}/materials`,
        z.array(source),
        { signal },
      ),
    enabled: active,
  });
  if (rows.isError)
    return (
      <p role="alert">
        {errorMessage(rows.error)}{' '}
        <Button variant="ghost" onClick={() => void rows.refetch()}>
          다시 확인
        </Button>
      </p>
    );
  return (
    <section aria-label="삽입한 레퍼런스">
      {rows.isPending ? (
        <p role="status">삽입한 자료를 확인합니다.</p>
      ) : (
        !!rows.data?.length && (
          <>
            <h3>삽입한 레퍼런스</h3>
            <ul className="presentation-citations">
              {rows.data.map((item) => (
                <li key={item.id}>
                  {item.preview && item.available && (
                    <img
                      src={fileUrl(item.job_id, item.preview)}
                      alt={item.title}
                      loading="lazy"
                      style={{ width: '100%', aspectRatio: '16/9', objectFit: 'contain' }}
                    />
                  )}
                  <strong>{item.title}</strong>
                  <p className="field-hint">원본 v{item.file_version}</p>
                  <Button
                    variant="secondary"
                    disabled={!item.available}
                    onClick={(e) => {
                      trigger.current = e.currentTarget;
                      setPreview(item);
                    }}
                  >
                    사용한 원본 보기
                  </Button>
                  {!item.available && (
                    <p className="field-hint">
                      원본이 제거되었습니다. 저장된 발표자료는 유지됩니다.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </>
        )
      )}
      {active && preview && (
        <ProcessingDialog
          item={{
            id: preview.item_id,
            kind: preview.source_kind,
            title: preview.title,
            version: preview.item_version,
            file_version: preview.file_version,
            job_id: preview.job_id,
            page_id: preview.page_id,
          }}
          returnFocus={trigger.current ?? undefined}
          onClose={() => setPreview(null)}
        />
      )}
    </section>
  );
}
