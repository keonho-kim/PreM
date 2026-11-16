// Purpose: Run explicit sample decisions against either a generation bridge or native decision API.
// Pattern: Local reviewed drafts, Query mutation state, version-scoped results and abort ownership.
// Usage: Admin decision tab; only supplied sample text is sent, never uploaded files.
// Related: decision-api.ts, provider-panels.tsx, backend/modules/decisions/.
import { useEffect, useId, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { errorMessage } from '@/shared/api/http';
import { type Provider, providerKeys } from './api';
import type { ProviderOption } from './provider-types';
import { evaluateDecision, questionsSchema } from './decision-api';
const example = JSON.stringify(
  {
    is_table_of_contents: {
      type: 'choice',
      instructions: '입력 state가 원본 문서의 목차 영역인가?',
      criteria: {
        '0': '일반 본문 또는 개별 제목이다.',
        '1': '문서의 구성과 순서를 안내하는 목차 영역이다.',
      },
    },
  },
  null,
  2,
);
export function DecisionChecks({
  provider,
  option,
}: {
  provider: Provider;
  option: ProviderOption;
}) {
  const prefix = useId();
  const [state, setState] = useState('목차\n1. 사업 개요 ... 3\n2. 추진 계획 ... 8');
  const [questions, setQuestions] = useState(example);
  const [invalid, setInvalid] = useState('');
  const [notice, setNotice] = useState('');
  const editor = useRef<HTMLTextAreaElement>(null);
  const controller = useRef<AbortController | null>(null);
  const cache = useQueryClient();
  useEffect(() => () => controller.current?.abort(), []);
  const mutation = useMutation({
    meta: { admin: true },
    mutationFn: (input: { state: string; questions: string }) => {
      controller.current = new AbortController();
      return evaluateDecision(provider, input.state, input.questions, controller.current.signal);
    },
    retry: false,
    onSettled: () => {
      void cache.invalidateQueries({ queryKey: providerKeys.history(provider.id) });
    },
  });
  const supported = option.category === 'system' || option.structured;
  const resetResult = () => {
    mutation.reset();
    setNotice('');
  };
  return (
    <section className="provider-checks" aria-labelledby={`${prefix}-title`}>
      <h2 id={`${prefix}-title`}>판정 테스트</h2>
      <p className="muted">
        입력한 샘플만 선택한 서버로 전송합니다. 파일 분석은 실행하지 않습니다.
      </p>
      <form
        className="decision-form"
        aria-labelledby={`${prefix}-title`}
        onSubmit={(e) => {
          e.preventDefault();
          if (mutation.isPending || !supported) return;
          let parsed: ReturnType<typeof questionsSchema.parse>;
          try {
            parsed = questionsSchema.parse(JSON.parse(questions));
          } catch {
            setInvalid('choice 질문 1~16개와 질문별 선택지 2~16개를 올바른 JSON으로 입력하세요.');
            editor.current?.focus();
            return;
          }
          if (
            new TextEncoder().encode(JSON.stringify({ state, questions: parsed })).length > 32768
          ) {
            setInvalid('입력과 질문을 합쳐 UTF-8 기준 32 KiB 이하로 줄이세요.');
            editor.current?.focus();
            return;
          }
          setInvalid('');
          setNotice('');
          mutation.mutate({ state, questions });
        }}
      >
        <div>
          <Label htmlFor={`${prefix}-state`}>판정할 내용 · 필수</Label>
          <Textarea
            id={`${prefix}-state`}
            name="decision_state"
            rows={5}
            required
            maxLength={16000}
            value={state}
            readOnly={mutation.isPending}
            onChange={(e) => {
              setState(e.target.value);
              resetResult();
            }}
          />
        </div>
        <div>
          <Label htmlFor={`${prefix}-questions`}>질문과 선택지 (JSON) · 필수</Label>
          <p id={`${prefix}-help`} className="field-hint">
            state를 참조하는 독립적인 choice 질문을 한 번에 처리합니다. 현재는 텍스트 선택형만
            지원합니다.
          </p>
          <Textarea
            ref={editor}
            id={`${prefix}-questions`}
            name="decision_questions"
            rows={12}
            required
            maxLength={20000}
            spellCheck={false}
            value={questions}
            readOnly={mutation.isPending}
            aria-invalid={Boolean(invalid)}
            aria-describedby={`${prefix}-help${invalid ? ` ${prefix}-error` : ''}`}
            onChange={(e) => {
              setQuestions(e.target.value);
              setInvalid('');
              resetResult();
            }}
          />
          {invalid && (
            <p id={`${prefix}-error`} className="form-message error">
              {invalid}
            </p>
          )}
        </div>
        {!supported && <p>{option.structured_reason}</p>}
        <div className="provider-actions">
          <Button type="submit" disabled={mutation.isPending || !provider.enabled || !supported}>
            {mutation.isPending ? '판정 중…' : '판정 실행'}
          </Button>
          {mutation.isPending && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                controller.current?.abort();
                setNotice(
                  '응답 대기를 중단했습니다. 서버에 전달된 판정은 제한 시간까지 계속될 수 있습니다.',
                );
              }}
            >
              응답 대기 중단
            </Button>
          )}
        </div>
      </form>
      <p role="status">
        {notice ||
          (mutation.isPending
            ? '선택한 모델이 질문을 판정하고 있습니다.'
            : mutation.isError
              ? errorMessage(mutation.error)
              : mutation.isSuccess
                ? '판정이 완료되었습니다.'
                : '')}
      </p>
      {!mutation.isPending && !mutation.isError && mutation.data && (
        <div className="provider-result">
          <h3>판정 결과 · {mutation.data.request.elapsed_ms} ms</h3>
          <dl>
            {Object.entries(mutation.data.result.answers).map(([id, answer]) => (
              <div key={id}>
                <dt>{id}</dt>
                <dd>
                  선택값: <strong>{answer.choice}</strong>
                  {answer.probabilities && (
                    <pre>{JSON.stringify(answer.probabilities, null, 2)}</pre>
                  )}
                  {answer.confidence !== null && (
                    <span>Provider confidence: {answer.confidence}</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
          <p>
            {mutation.data.result.statistics === 'unavailable'
              ? 'LLM 선택값입니다. 확률은 제공하지 않습니다.'
              : '확률과 confidence는 Provider 보고값이며 실제 문서에서의 정확도를 보장하지 않습니다.'}
          </p>
        </div>
      )}
    </section>
  );
}
