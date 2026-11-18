// Purpose: Check the selected saved model with a short request appropriate to its role.
// Pattern: Version-pinned Admin APIs validate text generation or a native/bridged choice result.
// Usage: Both model connection sections expose the action beside their saved connection.
// Related: api.ts, decision-api.ts, provider-directory.tsx.
import { useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/shared/api/http';
import { providerKeys, testProvider, type Provider } from './api';
import { evaluateDecision } from './decision-api';

const questions = JSON.stringify({
  category: {
    type: 'choice',
    instructions: '입력에 맞는 유형을 선택하세요.',
    criteria: { '0': '일반 문장', '1': '문서 목차' },
  },
});
export function ConnectionDiagnostic({
  provider,
  decision,
}: {
  provider: Provider | null;
  decision: boolean;
}) {
  const client = useQueryClient();
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const check = useMutation({
    retry: false,
    meta: { admin: true },
    mutationFn: async (connection: Provider) => {
      const pending = new AbortController();
      controller.current = pending;
      try {
        const response = decision
          ? await evaluateDecision(connection, '목차\n1. 개요\n2. 계획', questions, pending.signal)
          : await testProvider(connection, 'text', pending.signal);
        return response.request;
      } catch (error) {
        if (pending.signal.aborted) return null;
        throw error;
      }
    },
    onSettled: (_data, _error, connection) => {
      void client.invalidateQueries({ queryKey: providerKeys.history(connection.id) });
    },
  });
  const responseType = decision ? '판정' : '텍스트';
  let status = `저장된 모델에 짧은 ${responseType} 요청을 보내 연결을 확인합니다.`;
  if (!provider) status = '연결을 저장하면 진단할 수 있습니다.';
  else if (!provider.enabled) status = '연결을 활성화한 뒤 진단하세요.';
  else if (check.isPending) status = `${provider.model_identifier} 응답을 기다리는 중입니다.`;
  else if (check.isError) status = `연결 진단 실패 · ${errorMessage(check.error)}`;
  else if (check.isSuccess) {
    status = check.data
      ? `연결 진단 성공 · ${provider.model_identifier} · ${responseType} 응답 확인`
      : '응답 대기를 중단했습니다.';
    if (check.data?.elapsed_ms != null) status += ` · ${check.data.elapsed_ms} ms`;
  }
  return (
    <section className="connection-diagnostic" aria-label="저장된 모델 연결 진단">
      <Button
        variant="secondary"
        disabled={!provider?.enabled || check.isPending}
        onClick={() => provider && check.mutate(provider)}
      >
        연결 진단
      </Button>
      {check.isPending && (
        <Button variant="ghost" onClick={() => controller.current?.abort()}>
          응답 대기 중단
        </Button>
      )}
      <p role="status">{status}</p>
    </section>
  );
}
