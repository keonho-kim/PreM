// Purpose: Edit one model connection without exposing stored endpoint or credential values.
// Pattern: Replacement-only sensitive fields and an optional disclosure for operational details.
// Usage: ProviderForm owns drafts; blank replacement fields preserve the saved connection.
// Related: provider-form.tsx, model-picker.tsx, api.ts.
import { ChevronDown } from 'lucide-react';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { useState, type ReactNode } from 'react';
import type { Provider, ProviderDraft } from './api';
import type { ProviderOption } from './provider-types';
export function ProviderConnectionFields({
  prefix,
  base,
  draft,
  catalog,
  pending,
  address,
  secret,
  clearSecret,
  addressRequired,
  update,
  modelPicker,
  onAddress,
  onSecret,
  onClear,
}: {
  prefix: string;
  base: Provider | null;
  draft: ProviderDraft;
  catalog: ProviderOption[];
  pending: boolean;
  address: string;
  secret: string;
  clearSecret: boolean;
  addressRequired: boolean;
  update: <K extends keyof ProviderDraft>(key: K, value: ProviderDraft[K]) => void;
  modelPicker: ReactNode;
  onAddress: (value: string) => void;
  onSecret: (value: string) => void;
  onClear: () => void;
}) {
  const option = catalog.find((item) => item.id === draft.provider_type);
  const changedType = Boolean(base && draft.provider_type !== base.provider_type);
  const [credentialsOpen, setCredentialsOpen] = useState(!base);
  return (
    <div className="provider-fields">
      <Collapsible
        open={credentialsOpen || addressRequired || changedType}
        onOpenChange={setCredentialsOpen}
      >
        {base && (
          <CollapsibleTrigger asChild>
            <Button type="button" variant="ghost" className="provider-options-trigger">
              <ChevronDown aria-hidden="true" />
              연결 주소·인증 변경
            </Button>
          </CollapsibleTrigger>
        )}
        <CollapsibleContent className="provider-credentials">
          <div>
            <Label htmlFor={`${prefix}-url`}>{base ? '새 연결 주소' : '연결 주소 · 필수'}</Label>
            <Input
              id={`${prefix}-url`}
              name="base_url"
              type="url"
              required={!base || changedType || addressRequired}
              maxLength={2048}
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="none"
              aria-describedby={`${prefix}-url-help`}
              value={address}
              readOnly={pending}
              placeholder={base ? '변경할 때만 입력' : option?.base}
              onChange={(e) => onAddress(e.target.value)}
            />
            <p id={`${prefix}-url-help`} className="field-hint">
              {base
                ? '비워 두면 현재 주소를 유지합니다.'
                : 'PreM에서 접근할 수 있는 모델 서버 주소를 입력하세요.'}
            </p>
          </div>
          <div>
            <Label htmlFor={`${prefix}-key`}>새 API Key</Label>
            <Input
              id={`${prefix}-key`}
              name="api_key"
              required={!base && option?.key}
              type="password"
              autoComplete="new-password"
              maxLength={4096}
              value={secret}
              readOnly={pending}
              aria-describedby={`${prefix}-key-help`}
              placeholder={base?.has_secret ? '변경할 때만 입력' : '인증이 필요한 경우 입력'}
              onChange={(e) => onSecret(e.target.value)}
            />
            <p id={`${prefix}-key-help`} className="field-hint">
              {clearSecret
                ? '저장하면 기존 키가 삭제됩니다.'
                : base?.has_secret
                  ? '키가 등록되어 있습니다. 비워 두면 기존 키를 유지합니다.'
                  : '인증이 없는 로컬 서버는 비워 두세요.'}
            </p>
            {base?.has_secret && (
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                aria-pressed={clearSecret}
                onClick={onClear}
              >
                {clearSecret ? '키 삭제 취소' : '저장된 키 삭제'}
              </Button>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
      {modelPicker}
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" className="provider-options-trigger">
            <ChevronDown aria-hidden="true" />
            추가 연결 설정
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="provider-fields">
          <div>
            <Label htmlFor={`${prefix}-name`}>표시 이름 · 필수</Label>
            <Input
              id={`${prefix}-name`}
              name="name"
              required
              maxLength={80}
              value={draft.name}
              readOnly={pending}
              onChange={(e) => update('name', e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor={`${prefix}-timeout`}>응답 제한 시간 (초) · 필수</Label>
            <Input
              id={`${prefix}-timeout`}
              name="timeout_seconds"
              type="number"
              min={5}
              max={900}
              required
              value={draft.timeout_seconds}
              readOnly={pending}
              onChange={(e) => update('timeout_seconds', Number(e.target.value))}
            />
          </div>
          <div>
            <Label htmlFor={`${prefix}-enabled`}>연결 상태</Label>
            <Select
              value={draft.enabled ? 'enabled' : 'disabled'}
              disabled={pending}
              onValueChange={(v) => update('enabled', v === 'enabled')}
            >
              <SelectTrigger id={`${prefix}-enabled`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="enabled">활성</SelectItem>
                <SelectItem value="disabled">비활성</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {option?.category === 'llm' && (
            <div>
              <Label htmlFor={`${prefix}-output`}>작성 출력 한도 (토큰) · 선택</Label>
              <Input
                id={`${prefix}-output`}
                name="max_output_tokens"
                type="number"
                min={256}
                max={65536}
                step={1}
                value={draft.max_output_tokens ?? ''}
                aria-describedby={`${prefix}-output-help`}
                readOnly={pending}
                onChange={(e) =>
                  update('max_output_tokens', e.target.value === '' ? null : Number(e.target.value))
                }
              />
              <p id={`${prefix}-output-help`} className="muted">
                빈 값은 작업별 기본 한도입니다. 256~65,536 범위로 지정하며, 추론형 모델은 추론과
                최종 답변이 이 한도를 함께 사용합니다. 모델 문맥 크기는 모델 서버에서 별도로
                설정합니다.
              </p>
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
