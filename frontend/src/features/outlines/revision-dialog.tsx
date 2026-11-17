// Purpose: Edit a generation outline from its row action while preserving canonical source links.
// Pattern: Version-pinned local draft; shadcn owns focus/dismissal and the caller commits the review.
// Usage: Pencil opens the selected heading; plus inserts a child with its branch's source context.
// Related: nodes.tsx, draft.ts, presentations/generation-form.tsx.
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/shared/api/http';
import { getOutline, outlineKeys, type Draft, type OutlineState } from './api';
import { OutlineNodes } from './nodes';
import { add } from './draft';
import './outline-dialogs.css';
import './outlines.css';
export type OutlineEdit = {
  expected_version: number;
  source_snapshot: string;
  guide_version: number;
  draft: Draft;
};
export type OutlineAction = { node: string; kind: 'edit' | 'add' };
export function OutlineRevisionDialog({
  project,
  action,
  onClose,
  onSave,
}: {
  project: string;
  action: OutlineAction;
  onClose: () => void;
  onSave: (input: OutlineEdit) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const result = useQuery({
    queryKey: outlineKeys.state(project),
    queryFn: ({ signal }) => getOutline(project, undefined, signal),
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent className="outline-edit-dialog" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogTitle>{action.kind === 'add' ? '중목차 추가' : '목차 수정'}</DialogTitle>
        <DialogDescription>
          제목과 순서를 수정하세요. 저장하면 생성할 목차에 반영됩니다.
        </DialogDescription>
        {result.isPending ? (
          <p role="status">목차를 불러옵니다.</p>
        ) : result.isError ? (
          <p role="alert">
            {errorMessage(result.error)}{' '}
            <Button onClick={() => void result.refetch()}>다시 확인</Button>
          </p>
        ) : (
          <Editor
            server={result.data}
            action={action}
            onSave={onSave}
            onClose={onClose}
            onPending={setSaving}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
function initial(server: OutlineState, action: OutlineAction) {
  if (action.kind === 'edit') return server.draft;
  const draft = add(server.draft, action.node);
  const child = draft.nodes.find((n) => !server.draft.nodes.some((old) => old.id === n.id));
  const branch = new Set(
    server.draft.nodes
      .filter((n) => n.id === action.node || n.parent_id === action.node)
      .map((n) => n.id),
  );
  const blocks = [
    ...new Set(
      server.draft.assignments.filter((a) => branch.has(a.node_id)).map((a) => a.block_id),
    ),
  ];
  return {
    ...draft,
    assignments: [
      ...draft.assignments,
      ...(child ? blocks.map((block_id) => ({ node_id: child.id, block_id })) : []),
    ],
  };
}
function Editor({
  server,
  action,
  onSave,
  onClose,
  onPending,
}: {
  server: OutlineState;
  onPending: (pending: boolean) => void;
  action: OutlineAction;
  onSave: (i: OutlineEdit) => Promise<void>;
  onClose: () => void;
}) {
  const [base] = useState(server);
  const [draft, setDraft] = useState(() => initial(server, action));
  const [selected, setSelected] = useState(
    () =>
      draft.nodes.find((n) => !server.draft.nodes.some((old) => old.id === n.id))?.id ??
      action.node,
  );
  const root = useRef<HTMLDivElement>(null);
  const initialSelection = useRef(selected);
  useEffect(() => {
    root.current
      ?.querySelector<HTMLInputElement>(`#outline-title-${initialSelection.current}`)
      ?.focus();
  }, []);
  const save = useMutation({
    mutationFn: () =>
      onSave({
        expected_version: base.version,
        source_snapshot: base.source_snapshot,
        guide_version: base.guide_version,
        draft,
      }),
    retry: false,
    onSuccess: onClose,
  });
  useEffect(() => {
    onPending(save.isPending);
    return () => onPending(false);
  }, [onPending, save.isPending]);
  const conflict =
    server.version !== base.version ||
    server.source_snapshot !== base.source_snapshot ||
    server.guide_version !== base.guide_version;
  const missing = draft.nodes.some(
    (n) =>
      !draft.nodes.some((c) => c.parent_id === n.id) &&
      !draft.assignments.some((a) => a.node_id === n.id),
  );
  return (
    <div ref={root}>
      <OutlineNodes
        draft={draft}
        selected={selected}
        disabled={save.isPending}
        onSelect={setSelected}
        onChange={(next) => {
          const added = next.nodes.filter(
            (n) => n.parent_id && !draft.nodes.some((old) => old.id === n.id),
          );
          const inherited = added.flatMap((n) => {
            const branch = new Set(
              draft.nodes
                .filter((old) => old.id === n.parent_id || old.parent_id === n.parent_id)
                .map((old) => old.id),
            );
            return [
              ...new Set(
                draft.assignments.filter((a) => branch.has(a.node_id)).map((a) => a.block_id),
              ),
            ].map((block_id) => ({ node_id: n.id, block_id }));
          });
          setDraft({ ...next, assignments: [...next.assignments, ...inherited] });
        }}
      />
      {action.kind === 'add' && (
        <p className="field-hint">새 중목차는 상위 목차의 원문 범위를 함께 참고합니다.</p>
      )}
      {missing && (
        <p role="status">연결된 원문이 없는 목차는 목차·내용 화면에서 원문을 연결해 주세요.</p>
      )}
      {conflict && (
        <p role="alert">
          다른 변경이 저장되었습니다. 입력은 유지됩니다. 닫은 뒤 최신 목차를 다시 열어 주세요.
        </p>
      )}
      {save.isError && <p role="alert">{errorMessage(save.error)}</p>}
      <div className="dialog-actions">
        <Button variant="ghost" disabled={save.isPending} onClick={onClose}>
          취소
        </Button>
        <Button
          disabled={save.isPending || conflict || missing || !draft.nodes.length}
          onClick={() => save.mutate()}
        >
          {save.isPending ? '저장 중…' : '목차 저장'}
        </Button>
      </div>
    </div>
  );
}
