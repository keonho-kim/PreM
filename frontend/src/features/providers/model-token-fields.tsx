// Purpose: Edit per-model generation budgets and LM Studio load settings next to model selection.
// Pattern: Native number constraints plus linked help; absent values retain provider defaults.
// Usage: One set of fields for the selected connection protocol.
// Related: connection-form/form-values.ts, prepare-model.tsx, backend/modules/model_registry/.
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ProviderDraft } from './api';
type Limit = 'context_length' | 'physical_batch_size' | 'max_output_tokens';
export function ModelTokenFields({
  prefix,
  draft,
  llm,
  disabled,
  update,
}: {
  prefix: string;
  draft: ProviderDraft;
  llm: boolean;
  disabled: boolean;
  update: (key: Limit, value: number | null) => void;
}) {
  const local = ['lm_studio_native', 'lm_studio', 'lm_studio_decision'].includes(
    draft.provider_type,
  );
  function field(key: Limit, label: string, help: string, min: number, max: number) {
    const id = prefix + '-' + key;
    return (
      <div>
        <Label htmlFor={id}>{label} · 선택</Label>
        <Input
          name={key}
          id={id}
          type="number"
          min={min}
          max={max}
          step={1}
          value={draft[key] ?? ''}
          readOnly={disabled}
          aria-describedby={id + '-help'}
          onChange={(e) => update(key, e.target.value === '' ? null : Number(e.target.value))}
        />
        <p id={id + '-help'} className="field-hint">
          {help}
        </p>
      </div>
    );
  }
  return (
    <>
      {llm &&
        field(
          'max_output_tokens',
          '최대 출력 토큰',
          '응답과 추론에 사용할 토큰 수입니다. 비우면 작업별 기본값을 사용합니다.',
          256,
          65536,
        )}
      {local &&
        field(
          'context_length',
          '컨텍스트 길이 (토큰)',
          '모델이 처리할 전체 문맥 길이입니다. 변경 후 저장하고 모델을 준비하세요.',
          1,
          2147483647,
        )}
      {local &&
        field(
          'physical_batch_size',
          '물리 배치 크기 (토큰)',
          'LM Studio가 한 번에 처리할 입력 크기입니다. 모델을 준비할 때 적용하며, 큰 값은 메모리를 더 사용합니다.',
          1,
          draft.context_length ?? 2147483647,
        )}
    </>
  );
}
