// Purpose: Own presentation creation drafts and explicit idempotent model requests.
// Pattern: Inline scope and writing fields; the server resolves and pins the writing connection.
// Usage: Studio creation body; row editing preserves generation drafts and versioned scope.
// Related: generation.tsx, api.ts, backend/adapters/sqlite/presentations/models.rs.
import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Presentation as PresentationIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { errorMessage } from '@/shared/api/http';
import { OutlineRevisionDialog, outlineKeys, type OutlineAction } from '@/features/outlines';
import {
  createRun,
  saveGenerationOutline,
  getGenerationScope,
  presentationKeys,
  type Generate,
  type Preparation,
  type Run,
} from './api';
import { GenerationScope, scopeLeaves } from './generation-scope';
export function GenerationForm({
  project,
  name,
  state,
  editable,
  active,
  busy,
  base,
  onCreated,
  onCancelBase,
}: {
  project: string;
  name: string;
  state: Preparation;
  editable: boolean;
  active: boolean;
  busy: boolean;
  base: Run | null;
  onCreated: (run: Run) => void;
  onCancelBase: () => void;
}) {
  const [editing, setEditing] = useState<OutlineAction | null>(null);
  const [title, setTitle] = useState(name),
    [instructions, setInstructions] = useState(''),
    [error, setError] = useState('');
  const receipt = useRef<{ stamp: string; key: string } | null>(null),
    titleField = useRef<HTMLInputElement>(null),
    scopeField = useRef<HTMLDivElement>(null);
  const client = useQueryClient();
  const scope = useQuery({
    queryKey: [...presentationKeys.preparation(project), 'sections', state.design_id],
    queryFn: ({ signal }) => getGenerationScope(project, state.design_id ?? '', signal),
    enabled: active && !!state.design_id,
  });
  const [choice, setChoice] = useState<{ revision: string; ids: string[] } | null>(null);
  const stale = !!choice && !!scope.data && choice.revision !== scope.data.outline_revision_id;
  const selected = stale
    ? []
    : (choice?.ids ?? (scope.data ? scopeLeaves(scope.data.sections) : []));
  useEffect(() => {
    if (base) titleField.current?.focus();
  }, [base]);
  const generate = useMutation({
    mutationFn: () => {
      if (!state.design_id) throw Error('generation input missing');
      const input: Generate = {
        node_ids: selected,
        design_id: state.design_id,
        title: base?.title ?? title,
        instructions,
        presentation_id: base?.presentation_id ?? null,
        expected_version: base?.presentation_version ?? 0,
      };
      const stamp = JSON.stringify(input);
      if (receipt.current?.stamp !== stamp) receipt.current = { stamp, key: crypto.randomUUID() };
      return createRun(project, receipt.current.key, input);
    },
    retry: false,
    onSuccess: (r) => {
      receipt.current = null;
      onCreated(r);
    },
  });
  return (
    <>
      <form
        className="presentation-form"
        aria-label="발표자료 생성"
        onSubmit={(e) => {
          e.preventDefault();
          if (!scope.data || stale || !selected.length) {
            setError(
              stale
                ? '목차가 변경되었습니다. 생성할 범위를 다시 선택하세요.'
                : '생성할 목차를 하나 이상 선택하세요.',
            );
            scopeField.current?.querySelector('button')?.focus();
            return;
          }
          setError('');
          generate.mutate();
        }}
      >
        <div className="generation-scope-area" ref={scopeField}>
          {scope.data && (
            <GenerationScope
              sections={scope.data.sections}
              selected={selected}
              disabled={!editable || busy || generate.isPending}
              onEdit={(node) => setEditing({ node, kind: 'edit' })}
              onAdd={(node) => setEditing({ node, kind: 'add' })}
              onChange={(ids) => {
                setChoice({ revision: scope.data.outline_revision_id, ids });
                setError('');
              }}
            />
          )}
          {state.design_id && scope.isPending && (
            <p role="status">생성할 목차를 불러오고 있습니다.</p>
          )}
          {stale && (
            <p role="alert">
              목차가 변경되었습니다.{' '}
              <Button type="button" variant="link" onClick={() => setChoice(null)}>
                현재 목차로 다시 선택
              </Button>
            </p>
          )}
          {scope.isError && (
            <p role="alert">
              {errorMessage(scope.error)}{' '}
              <Button
                type="button"
                variant="link"
                onClick={() => {
                  void scope.refetch();
                  void client.invalidateQueries({
                    queryKey: presentationKeys.preparation(project),
                  });
                }}
              >
                목차 다시 불러오기
              </Button>
            </p>
          )}
        </div>
        <div className="generation-details">
          <div>
            <Label htmlFor="presentation-title">발표자료 제목</Label>
            <Input
              id="presentation-title"
              ref={titleField}
              name="title"
              value={base?.title ?? title}
              required
              readOnly={!!base}
              maxLength={120}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="presentation-instructions">
            <Label htmlFor="presentation-instructions">이번 발표자료에 추가할 요청 (선택)</Label>
            <Textarea
              id="presentation-instructions"
              name="instructions"
              value={instructions}
              maxLength={1000}
              placeholder="예: 의사결정자가 핵심을 빠르게 볼 수 있도록 간결하게 작성"
              onChange={(e) => setInstructions(e.target.value)}
            />
          </div>
        </div>
        {scope.data && (
          <p className="field-hint">
            선택한 목차 기준 {selected.length}장 · 목차별 원문 최대 12곳과 앞에서 선택한 근거의
            발췌를 참고합니다. 완성 후 수치와 표현을 확인해 주세요.
          </p>
        )}
        {!state.design_id && <p role="status">근거와 템플릿 선택을 먼저 확인하세요.</p>}
        {base && (
          <p role="status">
            {base.title}의 새 버전을 만듭니다. 선택하지 않은 목차는 새 파일에서 제외되며 이전 파일은
            유지됩니다.{' '}
            <Button type="button" variant="link" onClick={onCancelBase}>
              새 발표자료로 만들기
            </Button>
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        {generate.isError && <p role="alert">{errorMessage(generate.error)}</p>}
        <Button
          type="submit"
          disabled={
            !editable ||
            !state.design_id ||
            busy ||
            generate.isPending ||
            scope.isPending ||
            scope.isError
          }
        >
          <PresentationIcon aria-hidden="true" />
          {generate.isPending ? '요청 중…' : base ? '새 버전 만들기' : 'PPT 만들기'}
        </Button>
      </form>
      {editing && (
        <OutlineRevisionDialog
          project={project}
          action={editing}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            const next = await saveGenerationOutline(project, input, state);
            client.setQueryData(presentationKeys.preparation(project), next);
            await client.invalidateQueries({ queryKey: outlineKeys.all });
            await client.invalidateQueries({ queryKey: presentationKeys.preparation(project) });
          }}
        />
      )}
    </>
  );
}
