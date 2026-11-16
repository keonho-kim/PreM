// Purpose: Preserve a version-pinned local outline draft while shared server state changes.
// Pattern: Explicit save/confirm and conflict review; no silent last-write-wins.
// Usage: OutlineWorkspace supplies the current or historical committed view.
// Related: nodes.tsx, mapping.tsx, generation.tsx, api.ts.
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Plus, ListTree } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { errorMessage } from '@/shared/api/http';
import { OutlineNodes } from './nodes';
import { ContentMapping } from './mapping';
import { Generation } from './generation';
import { add } from './draft';
import { saveOutline, confirmOutline, outlineKeys, type Draft, type OutlineState } from './api';
export function OutlineEditor({
  project,
  server,
  editable,
  historical,
  onDirty,
}: {
  project: string;
  server: OutlineState;
  editable: boolean;
  historical: boolean;
  onDirty?: (dirty: boolean) => void;
}) {
  const [session, setSession] = useState(() => ({
    version: server.version,
    draft: server.draft,
    base: JSON.stringify(server.draft),
    snapshot: server.source_snapshot,
    guide: server.guide_version,
    fresh: false,
  }));
  const editTrigger = useRef<HTMLButtonElement | null>(null);
  const emptyTrigger = useRef<HTMLButtonElement | null>(null);
  const [organizing, setOrganizing] = useState(false);
  const [selected, setSelected] = useState(server.draft.nodes[0]?.id ?? '');
  const client = useQueryClient();
  const dirty = session.fresh || JSON.stringify(session.draft) !== session.base;
  const inputChanged =
    session.snapshot !== server.source_snapshot || session.guide !== server.guide_version;
  const conflict = server.version !== session.version;
  useEffect(() => {
    onDirty?.(dirty);
    return () => onDirty?.(false);
  }, [dirty, onDirty]);
  useEffect(() => {
    if (
      !dirty &&
      (server.version > session.version ||
        (!server.revision_id &&
          (server.source_snapshot !== session.snapshot || server.guide_version !== session.guide)))
    ) {
      setSession({
        version: server.version,
        draft: server.draft,
        base: JSON.stringify(server.draft),
        snapshot: server.source_snapshot,
        guide: server.guide_version,
        fresh: false,
      });
    }
  }, [server, dirty, session.version, session.snapshot, session.guide]);
  const active = session.draft.nodes.some((n) => n.id === selected)
    ? selected
    : (session.draft.nodes[0]?.id ?? '');
  const readonly = !editable || historical || (server.stale && !session.fresh);
  const saved = (value: OutlineState) => {
    client.setQueryData(outlineKeys.state(project), value);
    setSession({
      version: value.version,
      draft: value.draft,
      base: JSON.stringify(value.draft),
      snapshot: value.source_snapshot,
      guide: value.guide_version,
      fresh: false,
    });
    void client.invalidateQueries({ queryKey: outlineKeys.all });
  };
  const save = useMutation({
    mutationFn: () =>
      saveOutline(project, session.version, session.snapshot, session.guide, session.draft),
    retry: false,
    onSuccess: saved,
    onError: () => void client.invalidateQueries({ queryKey: outlineKeys.state(project) }),
  });
  const confirm = useMutation({
    mutationFn: () => confirmOutline(project, session.version),
    retry: false,
    onSuccess: saved,
    onError: () => void client.invalidateQueries({ queryKey: outlineKeys.state(project) }),
  });
  const change = (draft: Draft) => setSession((old) => ({ ...old, draft }));
  const reset = () => {
    setSession({
      version: server.version,
      draft: server.draft,
      base: JSON.stringify(server.draft),
      snapshot: server.source_snapshot,
      guide: server.guide_version,
      fresh: false,
    });
    save.reset();
    confirm.reset();
  };
  const busy = save.isPending || confirm.isPending;
  return (
    <>
      {!historical && (
        <Generation
          project={project}
          state={server}
          disabled={!editable || dirty || busy || conflict}
          selected={active}
        />
      )}
      {(server.stale || inputChanged) && (
        <p role="status">
          원본 또는 작성 방향이 바뀌었습니다. 이전 목차는 보존되어 있습니다. 새 목차를 만들거나 새
          입력으로 직접 구성하세요.
        </p>
      )}
      {(!session.draft.nodes.length || server.stale || inputChanged) && !historical && (
        <Button
          variant="secondary"
          ref={emptyTrigger}
          disabled={!editable || !server.ready || busy}
          onClick={() =>
            setSession({
              version: server.version,
              draft: session.draft.nodes.length
                ? { ...session.draft, assignments: [] }
                : add({ nodes: [], assignments: [] }, null),
              base: JSON.stringify(server.draft),
              snapshot: server.source_snapshot,
              guide: server.guide_version,
              fresh: true,
            })
          }
        >
          {session.draft.nodes.length ? '목차를 유지하고 다시 연결' : '직접 목차 작성'}
        </Button>
      )}
      {conflict && dirty && (
        <p role="alert">
          다른 변경이 저장되었습니다. 내 입력은 그대로 남아 있습니다. 최신 목차를 불러온 뒤 다시
          편집하세요.
        </p>
      )}
      {!!active && (
        <Tabs
          className="outline-content-tabs"
          value={active}
          onValueChange={setSelected}
          activationMode="manual"
        >
          <div className="outline-strip">
            <div className="outline-strip-heading">
              <h3>발표 순서</h3>
              {!historical && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="목차 편집"
                  onClick={(event) => {
                    editTrigger.current = event.currentTarget;
                    setOrganizing(true);
                  }}
                >
                  <ListTree />
                </Button>
              )}
            </div>
            <TabsList aria-label="내용을 연결할 목차">
              {session.draft.nodes.map((n, index) => (
                <TabsTrigger key={n.id} value={n.id}>
                  <span className="outline-position">{index + 1}</span>
                  <span>
                    {n.parent_id ? '↳ ' : ''}
                    {n.title || '제목 없음'}
                  </span>
                  <small>
                    {session.draft.assignments.filter((a) => a.node_id === n.id).length}
                  </small>
                </TabsTrigger>
              ))}
            </TabsList>
            {!historical && (
              <Button
                variant="secondary"
                disabled={readonly || busy || session.draft.nodes.length >= 24}
                onClick={(event) => {
                  editTrigger.current = event.currentTarget;
                  const next = add(session.draft, null);
                  change(next);
                  setSelected(next.nodes.at(-1)?.id ?? active);
                  setOrganizing(true);
                }}
              >
                <Plus aria-hidden="true" />
                목차 추가
              </Button>
            )}
          </div>
          <TabsContent value={active}>
            <ContentMapping
              key={active}
              project={project}
              revision={
                historical || (server.stale && !session.fresh)
                  ? (server.revision_id ?? undefined)
                  : undefined
              }
              draft={session.draft}
              nodeId={active}
              disabled={readonly || busy}
              onChange={change}
              onEdit={
                !historical
                  ? (trigger) => {
                      editTrigger.current = trigger;
                      setOrganizing(true);
                    }
                  : undefined
              }
            />
          </TabsContent>
        </Tabs>
      )}
      <Dialog open={organizing} onOpenChange={setOrganizing}>
        <DialogContent
          className="outline-edit-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            (editTrigger.current?.isConnected
              ? editTrigger.current
              : emptyTrigger.current
            )?.focus();
          }}
        >
          <DialogTitle>목차 편집</DialogTitle>
          <DialogDescription>
            발표 순서와 제목을 정리하세요. 변경한 내용은 화면 아래에서 저장합니다.
          </DialogDescription>
          <OutlineNodes
            draft={session.draft}
            disabled={readonly || busy}
            selected={active}
            onSelect={setSelected}
            onChange={change}
          />
          <div className="dialog-actions">
            <Button variant="secondary" onClick={() => setOrganizing(false)}>
              편집 마치기
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {(save.isError || confirm.isError) && (
        <p role="alert">{errorMessage(save.error ?? confirm.error)}</p>
      )}
      <footer className="outline-save">
        <p role="status">
          {historical
            ? `이전 버전 ${server.version} 조회`
            : dirty
              ? '저장하지 않은 변경이 있습니다.'
              : server.confirmed
                ? '목차와 내용 연결을 확정했습니다.'
                : `저장된 버전 ${server.version || '없음'}`}
        </p>
        {!historical && (
          <>
            <Button variant="ghost" disabled={!dirty && !conflict} onClick={reset}>
              저장된 목차 불러오기
            </Button>
            <Button
              variant="secondary"
              disabled={
                readonly ||
                busy ||
                !dirty ||
                conflict ||
                !server.ready ||
                inputChanged ||
                !session.draft.nodes.length
              }
              onClick={() => save.mutate()}
            >
              목차·연결 저장
            </Button>
            <Button
              disabled={
                readonly ||
                busy ||
                dirty ||
                conflict ||
                !session.version ||
                server.confirmed ||
                server.stale
              }
              onClick={() => confirm.mutate()}
            >
              목차·내용 확정
            </Button>
          </>
        )}
      </footer>
    </>
  );
}
