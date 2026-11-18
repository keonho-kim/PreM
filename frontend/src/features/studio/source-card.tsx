// Purpose: Present one immutable project-original registration with explicit file actions.
// Pattern: shadcn menu separates preview from version, replacement and removal commands.
// Usage: Studio's source gallery; no guessed previews or completion percentages.
// Related: studio-workspace.tsx, features/space/index.ts.
import { FileText, MoreHorizontal, Download, History, Replace, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { downloadUrl, sizeLabel, type Asset } from '@/features/space';
import { processingLabel } from '@/features/document-processing';
export type SourceAction = 'preview' | 'versions' | 'replace' | 'remove';
export function SourceCard({
  item,
  editable,
  onAction,
}: {
  item: Asset;
  editable: boolean;
  onAction: (action: SourceAction, item: Asset, trigger: HTMLElement) => void;
}) {
  return (
    <article className="studio-source-card" aria-label={item.title}>
      <div>
        <h3>
          <Button
            variant="ghost"
            className="studio-source-title studio-source-open"
            aria-label={item.title + ' 미리보기'}
            onClick={(e) => onAction('preview', item, e.currentTarget)}
          >
            <FileText aria-hidden="true" />
            <span>{item.title}</span>
          </Button>
        </h3>
        <p className="muted">
          {item.format.toUpperCase()} · {sizeLabel(item.size_bytes)} · 버전 {item.file_version}
        </p>
        <p>
          {item.processing === 'waiting_configuration'
            ? '내용 확인 가능'
            : processingLabel(item.processing, false)}
        </p>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`${item.title} 메뉴`}>
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <a href={downloadUrl(item.kind, item.id)}>
              <Download />
              원본 다운로드
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => onAction('versions', item, document.activeElement as HTMLElement)}
          >
            <History />
            파일 버전
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!editable}
            onSelect={() => onAction('replace', item, document.activeElement as HTMLElement)}
          >
            <Replace />
            파일 교체
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!editable}
            onSelect={() => onAction('remove', item, document.activeElement as HTMLElement)}
          >
            <Trash2 />
            문서 제거
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </article>
  );
}
