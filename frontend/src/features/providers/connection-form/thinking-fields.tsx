// Purpose: Select optional writing-model thinking controls and show observed provider responses.
// Pattern: All effort levels remain available while thinking is enabled; decision is always off.
// Usage: Inside the advanced connection settings disclosure.
// Related: use-draft-diagnostic.ts, provider-connection-fields.tsx.
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from '@/components/ui/select';
import { efforts, type DraftDiagnostic, type ProviderDraft } from '../api';
export function ThinkingFields({
  prefix,
  decision,
  draft,
  update,
  result,
  error,
  disabled,
}: {
  prefix: string;
  decision: boolean;
  draft: ProviderDraft;
  update: <K extends keyof ProviderDraft>(key: K, v: ProviderDraft[K]) => void;
  result?: DraftDiagnostic;
  error?: string;
  disabled: boolean;
}) {
  const active = !decision && draft.thinking === true;
  const msg =
    result && active
      ? [
          result.message,
          result.effort_unverified &&
            '서버가 알 수 없는 effort 값도 수락했습니다. 강도 적용은 확인할 수 없어 Thinking 켜기만 요청합니다.',
          result.advertised && `서버가 명시한 값: ${result.advertised.join(', ') || '없음'}.`,
          `진단 요청이 통과한 effort: ${result.accepted_efforts.join(', ') || '없음'}.`,
          result.ticket &&
            draft.thinking_effort !== result.effective_effort &&
            (result.effective_effort
              ? `적용할 값: ${result.effective_effort}.`
              : '선택한 effort는 적용하지 않고 Thinking만 켭니다.'),
        ]
          .filter(Boolean)
          .join(' ')
      : null;
  return (
    <>
      <div>
        <Label htmlFor={`${prefix}-thinking`}>Thinking · 선택</Label>
        <Select
          value={decision ? 'off' : draft.thinking == null ? 'auto' : draft.thinking ? 'on' : 'off'}
          disabled={decision || disabled}
          onValueChange={(v) => {
            update('thinking', v === 'auto' ? null : v === 'on');
            if (v !== 'on') update('thinking_effort', null);
          }}
        >
          <SelectTrigger id={`${prefix}-thinking`} aria-describedby={`${prefix}-thinking-hint`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">모델 기본값</SelectItem>
            <SelectItem value="on">켜기</SelectItem>
            <SelectItem value="off">끄기</SelectItem>
          </SelectContent>
        </Select>
        <p
          id={`${prefix}-thinking-hint`}
          className={
            error || (result && draft.thinking != null) ? 'thinking-feedback' : 'field-hint'
          }
        >
          {decision
            ? '판정 요청에서는 Thinking을 끕니다.'
            : error ||
              result?.message ||
              (result?.ticket && draft.thinking != null
                ? draft.thinking
                  ? result.thinking_observed
                    ? 'Thinking 켜기 요청 통과 · 모델 응답에서 추론 사용 확인'
                    : 'Thinking 켜기 요청 통과 · 모델의 실제 추론 사용 여부 미확인'
                  : 'Thinking 끄기 요청 통과'
                : '선택 사항입니다. 켜기 또는 effort를 변경하면 지원 값을 확인하기 위해 여러 건의 짧은 요청을 보냅니다.')}
        </p>
      </div>
      {active && (
        <div>
          <Label htmlFor={`${prefix}-effort`}>Thinking Effort · 선택</Label>
          <Select
            disabled={disabled}
            value={draft.thinking_effort ?? 'auto'}
            onValueChange={(v) => update('thinking_effort', efforts.find((e) => e === v) ?? null)}
          >
            <SelectTrigger id={`${prefix}-effort`} aria-describedby={`${prefix}-effort-hint`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">지정하지 않음</SelectItem>
              {efforts.map((e) => (
                <SelectItem key={e} value={e}>
                  {e}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p
            id={`${prefix}-effort-hint`}
            className={msg || error ? 'thinking-feedback' : 'field-hint'}
          >
            {msg || error || '진단 후 서버가 수락한 값을 표시합니다.'}
          </p>
        </div>
      )}
    </>
  );
}
