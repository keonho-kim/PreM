// Purpose: Verify one saved configuration without sending uploaded documents.
// Pattern: Explicit cancellable response waiting and query-owned sanitized history.
// Usage: Keyed by provider ID/version so stale results cannot describe a newer config.
// Related: api.ts, provider-directory.tsx, backend/modules/inference/.
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import type { ProviderOption } from './provider-types';
import { errorMessage } from '@/shared/api/http';
import { listModels, testProvider, providerKeys, type Provider } from './api';
export function ProviderChecks({
  provider,
  option,
}: {
  provider: Provider;
  option: ProviderOption;
}) {
  const controller = useRef<AbortController | null>(null);
  const [notice, setNotice] = useState('');
  const cache = useQueryClient();
  useEffect(() => () => controller.current?.abort(), []);
  const check = useMutation({
    meta: { admin: true },
    mutationFn: async (kind: 'models' | 'text' | 'structured') => {
      controller.current?.abort();
      controller.current = new AbortController();
      setNotice('');
      const signal = controller.current.signal;
      return kind === 'models'
        ? { kind, models: await listModels(provider, signal), result: null }
        : { kind, models: null, result: await testProvider(provider, kind, signal) };
    },
    retry: false,
    onSettled: () => {
      void cache.invalidateQueries({ queryKey: providerKeys.history(provider.id) });
    },
  });
  const result = check.data;
  return (
    <section className="provider-checks" aria-labelledby="provider-check-title">
      <h2 id="provider-check-title">
        연결 테스트 <span className="muted">v{provider.version}</span>
      </h2>
      <p className="muted">
        저장된 설정으로 짧은 샘플만 전송합니다. 업로드한 문서는 보내지 않습니다.
      </p>
      <div className="provider-actions">
        <Button
          variant="secondary"
          disabled={check.isPending || !provider.enabled}
          onClick={() => check.mutate('models')}
        >
          모델 목록 조회
        </Button>
        <Button
          variant="secondary"
          disabled={check.isPending || !provider.enabled || option.category === 'system'}
          onClick={() => check.mutate('text')}
        >
          텍스트 테스트
        </Button>
        <Button
          variant="secondary"
          disabled={check.isPending || !provider.enabled || !option.structured}
          onClick={() => check.mutate('structured')}
        >
          구조화 응답 테스트
        </Button>
        {check.isPending && (
          <Button
            variant="ghost"
            onClick={() => {
              controller.current?.abort();
              setNotice(
                '응답 대기를 중단했습니다. 서버에 전달된 추론은 제한 시간까지 계속될 수 있습니다.',
              );
            }}
          >
            응답 대기 중단
          </Button>
        )}
      </div>
      {!option.structured && (
        <p className="field-hint">
          {option.structured_reason ?? '이 Provider API는 구조화 출력을 지원하지 않습니다.'}
        </p>
      )}
      <p role="status">
        {check.isPending
          ? `모델 서버의 응답을 기다립니다. 초기 로딩을 포함해 최대 ${provider.timeout_seconds}초입니다.`
          : notice ||
            (check.isError
              ? errorMessage(check.error)
              : result
                ? '테스트가 완료되었습니다.'
                : '모델 목록은 서버 카탈로그입니다. 판정·생성 지원 여부는 각각 테스트하세요.')}
      </p>
      {!check.isPending && !check.isError && result?.models && (
        <div className="provider-models">
          <h3>서버 모델 {result.models.length}개</h3>
          {result.models.length ? (
            <ul>
              {result.models.map((id) => (
                <li key={id}>
                  <code>{id}</code>
                  {id === provider.model_identifier ? ' · 현재 선택' : ''}
                </li>
              ))}
            </ul>
          ) : (
            <p>표시할 모델이 없습니다. LM Studio에서 모델을 준비하세요.</p>
          )}
        </div>
      )}
      {!check.isPending && !check.isError && result?.result && (
        <div className="provider-result">
          <h3>{result.kind === 'structured' ? 'JSON Schema 검증 통과' : '텍스트 응답 수신'}</h3>
          <pre>{result.result.text}</pre>
          <p>
            {result.result.request.elapsed_ms} ms · 입력{' '}
            {result.result.request.prompt_tokens ?? '미제공'} / 출력{' '}
            {result.result.request.completion_tokens ?? '미제공'} 토큰
          </p>
        </div>
      )}
      <p className="field-hint">
        Vision·Tool Calling·스트리밍·자동 문서 처리는 아직 연결하지 않았습니다.
      </p>
    </section>
  );
}
