// Purpose: Load the shared Studio outline and its immutable revision history.
// Pattern: Query/route selection owns committed data; the editor owns unsaved changes.
// Usage: Studio third step; dirty drafts prevent history switching.
// Related: editor.tsx, api.ts, outlines.css.
import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { errorMessage } from '@/shared/api/http';
import { getOutline, getHistory, outlineKeys } from './api';
import { OutlineEditor } from './editor';
import './outline-dialogs.css';
import './outlines.css';
export function OutlineWorkspace({
  project,
  editable,
  onDirty,
  active = true,
}: {
  project: string;
  editable: boolean;
  active?: boolean;
  onDirty?: (dirty: boolean) => void;
}) {
  const [revision, setRevision] = useState('current'),
    [dirty, setDirty] = useState(false);
  const reportDirty = useCallback(
    (value: boolean) => {
      setDirty(value);
      onDirty?.(value);
    },
    [onDirty],
  );
  const state = useQuery({
    queryKey: outlineKeys.state(project, revision === 'current' ? undefined : revision),
    queryFn: ({ signal }) =>
      getOutline(project, revision === 'current' ? undefined : revision, signal),
    retry: false,
    enabled: active,
    refetchInterval: active && revision === 'current' ? 2000 : false,
  });
  const history = useQuery({
    queryKey: [...outlineKeys.history(project), state.data?.version],
    queryFn: ({ signal }) => getHistory(project, signal),
    enabled: active,
  });
  return (
    <section className="outline-workspace">
      <header className="outline-section-heading">
        <div>
          <h2>목차 정리</h2>
          <p className="muted">목차를 선택하고 연결된 원문 근거를 검토하세요.</p>
        </div>
        <div>
          <Label htmlFor="outline-history">목차 버전</Label>
          <Select value={revision} onValueChange={setRevision} disabled={dirty}>
            <SelectTrigger id="outline-history">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="current">현재 목차</SelectItem>
              {history.data?.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  버전 {r.number}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </header>
      {state.isPending ? (
        <p role="status">목차를 불러옵니다.</p>
      ) : state.isError ? (
        <p role="alert">
          {errorMessage(state.error)}{' '}
          <Button variant="secondary" onClick={() => void state.refetch()}>
            다시 시도
          </Button>
        </p>
      ) : (
        <>
          {!state.data.ready && (
            <p role="status">원본 문서를 확인해 주세요. 입력 중인 목차는 그대로 유지됩니다.</p>
          )}
          <OutlineEditor
            key={`${project}:${revision}`}
            project={project}
            server={state.data}
            editable={editable}
            historical={revision !== 'current'}
            onDirty={reportDirty}
          />
        </>
      )}
    </section>
  );
}
