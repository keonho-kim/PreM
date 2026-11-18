// Purpose: Own the outline draft, source version and explicit save/confirm transitions.
// Pattern: Feature-owned state and presentational composition have separate owners.
// Usage: Imported only by the owning feature.
// Related: index.tsx, ../api.ts.
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { saveOutline, confirmOutline, outlineKeys, type Draft, type OutlineState } from '../api';
export type EditorProps = {
  project: string;
  server: OutlineState;
  editable: boolean;
  historical: boolean;
  active?: boolean;
  onDirty?: (dirty: boolean) => void;
};
export function useOutlineSession({ project, server, editable, historical, onDirty }: EditorProps) {
  const [session, setSession] = useState(() => ({
    version: server.version,
    draft: server.draft,
    base: JSON.stringify(server.draft),
    snapshot: server.source_snapshot,
    guide: server.guide_version,
    fresh: false,
  }));
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
  return {
    session,
    setSession,
    dirty,
    inputChanged,
    conflict,
    readonly,
    save,
    confirm,
    change,
    reset,
    busy,
  };
}
