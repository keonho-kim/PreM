// Purpose: Share project commands across official shadcn context and dropdown menus.
// Pattern: Radix owns menu navigation, dismissal, positioning and focus containment.
// Usage: ProjectCard and ProjectDirectory supply their concrete trigger element.
// Related: components/ui/context-menu.tsx, components/ui/dropdown-menu.tsx.
import { useRef, type KeyboardEvent, type ReactElement } from 'react';
import { Archive, ArchiveRestore, Copy, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Project } from './api';
export type ProjectCommand = 'create' | 'rename' | 'copy' | 'status' | 'delete';
type Commands = {
  project?: Project;
  onCommand: (command: ProjectCommand, project?: Project) => void;
};
function Items({
  project,
  choose,
  kind,
}: {
  project?: Project;
  choose: (command: ProjectCommand) => void;
  kind: 'context' | 'dropdown';
}) {
  const Item = kind === 'context' ? ContextMenuItem : DropdownMenuItem;
  const Separator = kind === 'context' ? ContextMenuSeparator : DropdownMenuSeparator;
  return (
    <>
      <Item onSelect={() => choose('create')}>
        <Plus aria-hidden="true" />새 프로젝트
      </Item>
      {project && (
        <>
          <Separator />
          <Item onSelect={() => choose('rename')}>
            <Pencil aria-hidden="true" />
            이름 바꾸기
          </Item>
          <Item onSelect={() => choose('copy')}>
            <Copy aria-hidden="true" />
            프로젝트 정보 복사
          </Item>
          <Item onSelect={() => choose('status')}>
            {project.status === 'active' ? (
              <Archive aria-hidden="true" />
            ) : (
              <ArchiveRestore aria-hidden="true" />
            )}
            {project.status === 'active' ? '보관' : '복원'}
          </Item>
          <Separator />
          <Item className="danger-action" onSelect={() => choose('delete')}>
            <Trash2 aria-hidden="true" />
            삭제
          </Item>
        </>
      )}
    </>
  );
}
export function ProjectMenu({ project, onCommand }: Commands) {
  const chosen = useRef<ProjectCommand | null>(null);
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          data-project-menu-trigger
          variant="secondary"
          size="icon"
          aria-label={`${project?.name} 메뉴`}
          title="프로젝트 메뉴"
        >
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="project-menu"
        align="end"
        collisionPadding={8}
        onCloseAutoFocus={(event) => {
          if (chosen.current) {
            event.preventDefault();
            const action = chosen.current;
            chosen.current = null;
            onCommand(action, project);
          }
        }}
      >
        <Items
          kind="dropdown"
          project={project}
          choose={(action) => {
            chosen.current = action;
          }}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
const nativeContext =
  'input,textarea,select,button,a:not([data-project-link]),[contenteditable=true],[role=combobox]';
function contextShortcut(event: KeyboardEvent<HTMLElement>) {
  if (event.defaultPrevented || (event.target as HTMLElement).closest(nativeContext)) return;
  if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
  event.preventDefault();
  event.stopPropagation();
  const target = event.target as HTMLElement,
    rect = target.getBoundingClientRect();
  target.dispatchEvent(
    new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + 8,
      clientY: rect.bottom,
    }),
  );
}
export function ProjectContextMenu({
  project,
  onCommand,
  children,
}: Commands & { children: ReactElement }) {
  const chosen = useRef<ProjectCommand | null>(null);
  const origin = useRef<HTMLElement | null>(null);
  return (
    <ContextMenu modal={false}>
      <ContextMenuTrigger
        asChild
        onContextMenuCapture={(event) => {
          // Preserve the browser menu on form controls without cancelling its default action.
          if ((event.target as HTMLElement).closest(nativeContext)) event.stopPropagation();
        }}
        onContextMenu={(event) => {
          origin.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
          event.stopPropagation();
        }}
        onKeyDown={contextShortcut}
      >
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent
        className="project-menu"
        collisionPadding={8}
        onCloseAutoFocus={(event) => {
          if (chosen.current) {
            event.preventDefault();
            const action = chosen.current;
            chosen.current = null;
            origin.current?.focus({ preventScroll: true });
            onCommand(action, project);
          }
        }}
      >
        <Items
          kind="context"
          project={project}
          choose={(action) => {
            chosen.current = action;
          }}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}
