// Purpose: Add actual blank slides and expose reversible per-slide duplicate/delete/move commands.
// Pattern: Radix menus own keyboard/dismissal behavior; mutations retain the deck's CAS/session.
// Usage: SlideRail header and each thumbnail's context menu.
// Related: canvas-api.ts, use-canvas-command.ts, slide-rail.tsx.
import { useQuery } from '@tanstack/react-query';
import { Plus, MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from '@/components/ui/context-menu';
import { getLayouts, canvasKeys, type CanvasOperation } from './canvas-api';
import type { ReactNode } from 'react';
export function AddSlide({
  project,
  run,
  enabled,
  onApply,
}: {
  project: string;
  run: string;
  enabled: boolean;
  onApply: (op: CanvasOperation) => void;
}) {
  const layouts = useQuery({
    queryKey: canvasKeys.layouts(project, null, run),
    queryFn: ({ signal }) => getLayouts(project, null, signal, run),
    enabled,
    staleTime: 60000,
  });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          disabled={!enabled}
          aria-label="새 슬라이드"
          title="새 슬라이드"
        >
          <Plus aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {layouts.isPending && <DropdownMenuItem disabled>배치를 불러오는 중…</DropdownMenuItem>}
        {layouts.isError && (
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              void layouts.refetch();
            }}
          >
            배치 다시 불러오기
          </DropdownMenuItem>
        )}
        {layouts.data?.map((l) => (
          <DropdownMenuItem
            key={l.key}
            onSelect={() => onApply({ kind: 'add_slide', layout_key: l.key })}
          >
            {l.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
export function SlideActions({
  children,
  position,
  total,
  enabled,
  onApply,
}: {
  children: ReactNode;
  position: number;
  total: number;
  enabled: boolean;
  onApply: (op: CanvasOperation) => void;
}) {
  const actions = [
    {
      name: '슬라이드 복제',
      disabled: total >= 24,
      op: { kind: 'duplicate_slide' } as CanvasOperation,
    },
    {
      name: '슬라이드 삭제',
      disabled: total <= 1,
      op: { kind: 'delete_slide' } as CanvasOperation,
    },
    {
      name: '위로 이동',
      disabled: position <= 1,
      op: { kind: 'move_slide', position: position - 1 } as CanvasOperation,
    },
    {
      name: '아래로 이동',
      disabled: position >= total,
      op: { kind: 'move_slide', position: position + 1 } as CanvasOperation,
    },
  ];
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="presentation-thumb-actions-owner">
          {children}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                disabled={!enabled}
                className="slide-overflow"
                aria-label={`슬라이드 ${position} 메뉴`}
                title="슬라이드 메뉴"
              >
                <MoreHorizontal aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {actions.map((a) => (
                <DropdownMenuItem
                  key={a.name}
                  disabled={!enabled || a.disabled}
                  onSelect={() => onApply(a.op)}
                >
                  {a.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {actions.map((a) => (
          <ContextMenuItem
            key={a.name}
            disabled={!enabled || a.disabled}
            onSelect={() => onApply(a.op)}
          >
            {a.name}
          </ContextMenuItem>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}
