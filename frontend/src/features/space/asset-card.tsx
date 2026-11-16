// Purpose: Display factual library metadata and a stable-ID action menu.
// Pattern: Semantic shadcn Card; file originals, metadata and processing state stay distinct.
// Usage: Space directory renders references or templates without simulated thumbnails.
// Related: api.ts, asset-dialog.tsx, version-dialog.tsx.
import { useRef } from 'react';
import {
  Archive,
  ArchiveRestore,
  Download,
  FileText,
  FileUp,
  History,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-react';
import { processingLabel } from '@/features/document-processing';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { downloadUrl, sizeLabel, type Asset, type LibraryKind } from './api';
export type AssetAction = 'edit' | 'status' | 'delete' | 'replace' | 'versions' | 'processing';
export function AssetCard({
  item,
  kind,
  onAction,
}: {
  item: Asset;
  kind: LibraryKind;
  onAction: (action: AssetAction, item: Asset, target: HTMLElement | null) => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null),
    choice = useRef<AssetAction | null>(null);
  return (
    <Card className="space-asset" data-asset-id={item.id} aria-label={item.title}>
      <header>
        <FileText size={24} aria-hidden="true" />
        <span>
          {kind === 'templates' ? '템플릿' : '레퍼런스'} · {item.format.toUpperCase()}
        </span>
        <span className="space-state">{item.status === 'archived' ? '보관됨' : '원본 등록됨'}</span>
      </header>
      <h2>
        <Button
          variant="ghost"
          className="space-title-button"
          aria-label={`${item.title} 미리보기`}
          onClick={(e) => onAction('processing', item, e.currentTarget)}
        >
          {item.title}
        </Button>
      </h2>
      <p className="space-filename">{item.filename}</p>
      <dl>
        <div>
          <dt>파일</dt>
          <dd>
            {sizeLabel(item.size_bytes)} · v{item.file_version}
          </dd>
        </div>
        <div>
          <dt>최근 변경</dt>
          <dd>
            {new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' }).format(item.updated_at)}
          </dd>
        </div>
      </dl>
      {!!item.tags.length && (
        <ul className="space-tags" aria-label="태그">
          {item.tags.map((tag) => (
            <li key={tag}>{tag}</li>
          ))}
        </ul>
      )}
      <footer>
        <span className="muted">{processingLabel(item.processing, kind === 'templates')}</span>
        <div className="space-row-actions">
          <Button asChild variant="secondary" size="icon">
            <a
              href={downloadUrl(kind, item.id)}
              aria-label={`${item.title} 원본 다운로드`}
              title="원본 다운로드"
            >
              <Download aria-hidden="true" />
            </a>
          </Button>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                ref={trigger}
                variant="ghost"
                size="icon"
                aria-label={`${item.title} 메뉴`}
                title="자료 메뉴"
              >
                <MoreHorizontal aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              collisionPadding={8}
              className="space-menu"
              onCloseAutoFocus={(event) => {
                if (choice.current) {
                  event.preventDefault();
                  const action = choice.current;
                  choice.current = null;
                  onAction(action, item, trigger.current);
                }
              }}
            >
              <DropdownMenuItem
                onSelect={() => {
                  choice.current = 'edit';
                }}
              >
                <Pencil aria-hidden="true" />
                정보 수정
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  choice.current = 'replace';
                }}
              >
                <FileUp aria-hidden="true" />새 파일 버전
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  choice.current = 'versions';
                }}
              >
                <History aria-hidden="true" />
                파일 버전
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => {
                  choice.current = 'status';
                }}
              >
                {item.status === 'active' ? (
                  <Archive aria-hidden="true" />
                ) : (
                  <ArchiveRestore aria-hidden="true" />
                )}
                {item.status === 'active' ? '보관' : '복원'}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="danger-action"
                onSelect={() => {
                  choice.current = 'delete';
                }}
              >
                <Trash2 aria-hidden="true" />
                삭제
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </footer>
    </Card>
  );
}
