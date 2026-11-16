// Purpose: Expose immutable original-file versions and explicit download actions.
// Pattern: Query owns version metadata; shadcn dialog owns focus and dismissal.
// Usage: Opened from a library item's menu; downloads always address an exact file version.
// Related: api.ts, asset-card.tsx, backend Space versions/download endpoints.
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { errorMessage } from '@/shared/api/http';
import {
  downloadUrl,
  getVersions,
  sizeLabel,
  spaceKeys,
  type Asset,
  type LibraryKind,
} from './api';
export function VersionDialog({
  kind,
  item,
  onClose,
  returnFocus,
}: {
  kind: LibraryKind;
  item: Asset;
  onClose: () => void;
  returnFocus?: HTMLElement;
}) {
  const result = useQuery({
    queryKey: spaceKeys.versions(kind, item.id),
    queryFn: ({ signal }) => getVersions(kind, item.id, signal),
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="space-dialog"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          (returnFocus?.isConnected
            ? returnFocus
            : document.querySelector<HTMLElement>('main h1')
          )?.focus();
        }}
      >
        <DialogTitle>파일 버전</DialogTitle>
        <DialogDescription>{item.title} · 이전 원본은 수정하지 않고 보존합니다.</DialogDescription>
        {result.isPending && <p role="status">버전을 불러오고 있습니다.</p>}
        {result.isError && (
          <div role="alert">
            <p>{errorMessage(result.error)}</p>
            <Button
              variant="secondary"
              onClick={() => {
                void result.refetch();
              }}
            >
              다시 불러오기
            </Button>
          </div>
        )}
        {result.data && (
          <ul className="space-version-list">
            {result.data.map((version) => (
              <li key={version.number}>
                <div>
                  <strong>
                    v{version.number} · {version.filename}
                  </strong>
                  <p className="muted">
                    {sizeLabel(version.size_bytes)} ·{' '}
                    {new Intl.DateTimeFormat('ko-KR', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    }).format(version.created_at)}
                  </p>
                </div>
                <Button asChild variant="secondary" size="icon">
                  <a
                    href={downloadUrl(kind, item.id, version.number)}
                    aria-label={`v${version.number} 원본 다운로드`}
                    title="원본 다운로드"
                  >
                    <Download aria-hidden="true" />
                  </a>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
