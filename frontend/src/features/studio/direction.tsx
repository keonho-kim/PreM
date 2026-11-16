// Purpose: Edit short optional Do/Don't guidance while retaining failed/conflicting drafts.
// Pattern: Feature-local draft with a pinned base revision; saving never starts processing.
// Usage: The confirmed-source Studio step mounts this editor for the current project.
// Related: api.ts, studio-workspace.tsx.
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { outlineKeys } from '@/features/outlines';
import { ApiError, errorMessage } from '@/shared/api/http';
import { getGuide, saveGuide, studioKeys, type Guide } from './api';
type Props = {
  project: string;
  editable: boolean;
  onDirty?: (dirty: boolean) => void;
  onContinue?: () => void;
};
export function Direction({ project, editable, onDirty, onContinue }: Props) {
  const result = useQuery({
    queryKey: studioKeys.guide(project),
    queryFn: ({ signal }) => getGuide(project, signal),
  });
  if (result.isPending) return <p role="status">작성 방향을 불러옵니다.</p>;
  if (result.isError)
    return (
      <p role="alert">
        {errorMessage(result.error)}{' '}
        <Button variant="secondary" onClick={() => void result.refetch()}>
          다시 시도
        </Button>
      </p>
    );
  return (
    <DirectionForm
      project={project}
      initial={result.data}
      editable={editable}
      onDirty={onDirty}
      onContinue={onContinue}
    />
  );
}
function DirectionForm({
  project,
  initial,
  editable,
  onDirty,
  onContinue,
}: Props & { initial: Guide }) {
  const [draft, setDraft] = useState(initial),
    [notice, setNotice] = useState(''),
    [baseline, setBaseline] = useState(initial);
  const dirty = draft.do_text !== baseline.do_text || draft.dont_text !== baseline.dont_text;
  useEffect(() => {
    onDirty?.(dirty);
    return () => onDirty?.(false);
  }, [dirty, onDirty]);
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: () => saveGuide(project, draft),
    retry: false,
    onSuccess: (value) => {
      setDraft(value);
      setBaseline(value);
      client.setQueryData(studioKeys.guide(project), value);
      setNotice('작성 방향을 저장했습니다.');
      void client.invalidateQueries({ queryKey: outlineKeys.all });
    },
  });
  const refresh = useMutation({
    mutationFn: () => getGuide(project),
    onSuccess: (latest) => {
      setDraft((old) => ({ ...old, version: latest.version }));
      save.reset();
      setNotice(
        `저장된 버전 ${latest.version}을 확인했습니다. 내 입력을 적용하려면 다시 저장하세요. 저장된 Do: ${latest.do_text || '없음'} / Don't: ${latest.dont_text || '없음'}`,
      );
    },
  });
  return (
    <form
      className="studio-direction"
      onSubmit={(e) => {
        e.preventDefault();
        setNotice('');
        save.mutate();
      }}
    >
      <header>
        <h2>어떤 방향으로 만들까요?</h2>
        <p className="muted">강조할 내용과 피할 내용을 짧게 적어주세요. 모두 선택 사항입니다.</p>
      </header>
      <Label htmlFor="guide-do">Do · 이렇게 해주세요</Label>
      <Textarea
        id="guide-do"
        value={draft.do_text}
        maxLength={2000}
        rows={5}
        disabled={!editable || save.isPending}
        placeholder="예: 실행 계획과 기대 효과를 먼저 보여주세요."
        onChange={(e) => setDraft({ ...draft, do_text: e.target.value })}
      />
      <Label htmlFor="guide-dont">Don't · 이것은 피해주세요</Label>
      <Textarea
        id="guide-dont"
        value={draft.dont_text}
        maxLength={2000}
        rows={5}
        disabled={!editable || save.isPending}
        placeholder="예: 근거 없는 수치나 과장된 표현은 넣지 마세요."
        onChange={(e) => setDraft({ ...draft, dont_text: e.target.value })}
      />
      <p className="field-hint">
        저장해도 기존 문서 분석이나 결과물은 바뀌지 않습니다. 저장한 방향으로 다음 단계에서 목차를
        만들 수 있습니다.
      </p>
      <div role="status">
        {save.isError
          ? errorMessage(save.error)
          : refresh.isError
            ? errorMessage(refresh.error)
            : notice}
      </div>
      {save.error instanceof ApiError && save.error.status === 409 && (
        <Button
          variant="secondary"
          type="button"
          disabled={refresh.isPending}
          onClick={() => refresh.mutate()}
        >
          최신 작성 방향 확인
        </Button>
      )}
      <footer>
        <span>저장된 버전 {draft.version || '없음'}</span>
        <Button type="submit" disabled={!editable || save.isPending || refresh.isPending}>
          {save.isPending ? '저장 중…' : '작성 방향 저장'}
        </Button>
        {onContinue && (
          <Button
            type="button"
            variant="secondary"
            disabled={!editable || save.isPending || refresh.isPending}
            onClick={() => {
              if (!dirty && draft.version > 0) onContinue();
              else save.mutate(undefined, { onSuccess: () => onContinue() });
            }}
          >
            저장하고 목차로
          </Button>
        )}
      </footer>
    </form>
  );
}
