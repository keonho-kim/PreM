// Purpose: Select a model from the provider's actual discovery response.
// Pattern: Shadcn controls with explicit loading, cancellation, empty and retry states.
// Usage: Connection form passes only model IDs and local discovery status.
// Related: use-model-discovery.ts, provider-form.tsx, api.ts.
import { X } from 'lucide-react';
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
export function ModelPicker({
  prefix,
  value,
  models,
  error,
  pending,
  cancelled,
  disabled,
  onLoad,
  kind,
  onCancel,
  onSelect,
}: {
  kind: string;
  prefix: string;
  value: string;
  models: string[] | null;
  error: unknown;
  pending: boolean;
  cancelled: boolean;
  disabled: boolean;
  onLoad: () => void;
  onCancel: () => void;
  onSelect: (value: string) => void;
}) {
  return (
    <div className="model-picker">
      {pending && (
        <div className="provider-actions">
          <Button type="button" variant="ghost" onClick={onCancel}>
            <X aria-hidden="true" />
            조회 취소
          </Button>
        </div>
      )}
      <Label htmlFor={`${prefix}-model`}>사용할 모델 · 필수</Label>
      <Select
        value={value}
        disabled={disabled}
        onOpenChange={(open) => {
          if (open && !pending) onLoad();
        }}
        onValueChange={onSelect}
      >
        <SelectTrigger id={`${prefix}-model`} aria-describedby={`${prefix}-models-help`}>
          <SelectValue placeholder="눌러서 모델 목록 조회" />
        </SelectTrigger>
        <SelectContent>
          {pending && (
            <p role="status" className="field-hint">
              모델을 불러오는 중…
            </p>
          )}
          {!pending && !models?.length && (
            <p className="field-hint">
              {error
                ? '조회에 실패했습니다. 닫고 다시 열어 재시도하세요.'
                : '선택할 모델이 없습니다.'}
            </p>
          )}
          {value && !models?.includes(value) && (
            <SelectItem value={value} disabled>
              {value} · 저장된 모델
            </SelectItem>
          )}
          {!pending &&
            models?.map((model) => (
              <SelectItem key={model} value={model}>
                {model} · {kind}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
      <p
        id={`${prefix}-models-help`}
        role="status"
        className={error ? 'form-message error' : 'field-hint'}
      >
        {pending
          ? '입력한 연결 정보로 모델을 불러옵니다. 설정은 아직 저장되지 않습니다.'
          : error
            ? errorMessage(error)
            : cancelled
              ? '조회를 취소했습니다. 다시 조회할 수 있습니다.'
              : models?.length === 0
                ? '선택할 모델이 없습니다. 서버에 사용할 모델이 준비되어 있는지 확인하세요.'
                : models
                  ? `${models.length}개 모델을 찾았습니다. 사용할 모델을 선택하세요.`
                  : '목록을 열면 서버에서 모델을 조회합니다.'}
      </p>
    </div>
  );
}
