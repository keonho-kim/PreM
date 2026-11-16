// Purpose: Require an explicit destination when uploading from the combined library.
// Pattern: Existing shadcn menu owns focus; chosen destination is pinned before opening a dialog.
// Usage: SpaceDirectory supplies a filter and receives a concrete library kind.
// Related: space-directory.tsx, upload-dialog.tsx, api.ts.
import { useRef } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { LibraryFilter, LibraryKind } from './api';
export function UploadAction({
  kind,
  onSelect,
}: {
  kind: LibraryFilter;
  onSelect: (kind: LibraryKind, target: HTMLButtonElement) => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const selected = useRef<LibraryKind | null>(null);
  if (kind !== 'all')
    return (
      <Button onClick={(event) => onSelect(kind, event.currentTarget)}>
        <Plus aria-hidden="true" />
        {kind === 'templates' ? '템플릿' : '레퍼런스'} 올리기
      </Button>
    );
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button ref={trigger}>
          <Plus aria-hidden="true" />
          자료 올리기
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={(event) => {
          const value = selected.current;
          selected.current = null;
          if (value && trigger.current) {
            event.preventDefault();
            onSelect(value, trigger.current);
          }
        }}
      >
        <DropdownMenuItem
          onSelect={() => {
            selected.current = 'references';
          }}
        >
          레퍼런스 올리기
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            selected.current = 'templates';
          }}
        >
          템플릿 올리기
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
