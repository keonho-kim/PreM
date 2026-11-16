// Purpose: Own presentation creation drafts and explicit idempotent model requests.
// Pattern: Persistent form inside a disclosure; public model choices never require Admin access.
// Usage: Generation opens settings for a new deck/version and keeps drafts when hidden.
// Related: generation.tsx, api.ts, features/providers/authoring-api.ts.
import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Presentation as PresentationIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { listAuthoringModels, authoringModelsKey } from '@/features/providers';
import { errorMessage } from '@/shared/api/http';
import { createRun, type Generate, type Preparation, type Run } from './api';
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
  const [title, setTitle] = useState(name),
    [instructions, setInstructions] = useState(''),
    [model, setModel] = useState(''),
    [error, setError] = useState('');
  const receipt = useRef<{ stamp: string; key: string } | null>(null),
    modelField = useRef<HTMLButtonElement>(null);
  const providers = useQuery({
    queryKey: authoringModelsKey,
    queryFn: ({ signal }) => listAuthoringModels(signal),
    enabled: active,
  });
  const options = providers.data ?? [];
  useEffect(() => {
    if (base) modelField.current?.focus();
  }, [base]);
  const generate = useMutation({
    mutationFn: () => {
      const provider = options.find((p) => p.id === model);
      if (!provider || !state.design_id) throw Error('generation input missing');
      const input: Generate = {
        design_id: state.design_id,
        title: base?.title ?? title,
        instructions,
        connection_id: provider.id,
        model_version: provider.version,
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
    onError: () => void providers.refetch(),
  });
  return (
    <form
      className="presentation-form"
      aria-label="발표자료 생성 설정"
      onSubmit={(e) => {
        e.preventDefault();
        if (!options.some((p) => p.id === model)) {
          setError('발표자료 작성에 사용할 AI를 선택하세요.');
          modelField.current?.focus();
          return;
        }
        setError('');
        generate.mutate();
      }}
    >
      <div>
        <Label htmlFor="presentation-title">발표자료 제목</Label>
        <Input
          id="presentation-title"
          name="title"
          value={base?.title ?? title}
          required
          readOnly={!!base}
          maxLength={120}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="presentation-model">작성에 사용할 AI</Label>
        <Select value={model} onValueChange={setModel}>
          <SelectTrigger id="presentation-model" ref={modelField}>
            <SelectValue placeholder="사용할 AI 선택" />
          </SelectTrigger>
          <SelectContent>
            {options.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
      <p className="field-hint">
        예상 {state.slide_count}장 · 목차별 원문 최대 12곳과 선택한 추가 근거의 발췌를 참고합니다.
        완성 후 수치와 표현을 확인해 주세요.
      </p>
      {!state.design_id && <p role="status">근거와 템플릿 선택을 먼저 확인하세요.</p>}
      {!options.length && !providers.isPending && (
        <p>
          사용할 AI가 없습니다. <Link to="/admin">Admin에서 연결 설정</Link>
        </p>
      )}
      {base && (
        <p role="status">
          {base.title}의 새 버전을 만듭니다. 이전 파일은 유지됩니다.{' '}
          <Button type="button" variant="link" onClick={onCancelBase}>
            새 발표자료로 만들기
          </Button>
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {generate.isError && <p role="alert">{errorMessage(generate.error)}</p>}
      <Button type="submit" disabled={!editable || !state.design_id || busy || generate.isPending}>
        <PresentationIcon aria-hidden="true" />
        {generate.isPending ? '요청 중…' : base ? '새 버전 만들기' : 'PPT 만들기'}
      </Button>
    </form>
  );
}
