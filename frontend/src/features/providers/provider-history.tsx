// Purpose: Display persisted provider request history independently of test controls.
// Pattern: Query owns server records; inactive tabs do not poll.
// Usage: ProviderPanels keeps the view mounted and enables reads only while visible.
// Related: api.ts, provider-checks.tsx, provider-panels.tsx.
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/shared/api/http';
import { getHistory, providerKeys } from './api';
export function ProviderHistory({ providerId, active }: { providerId: string; active: boolean }) {
  const history = useQuery({
    queryKey: providerKeys.history(providerId),
    queryFn: ({ signal }) => getHistory(providerId, signal),
    enabled: active,
    refetchInterval: active ? 5000 : false,
  });
  return (
    <section
      className="provider-history"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: Named horizontal table viewport needs keyboard scrolling.
      tabIndex={0}
      aria-label="최근 연결 테스트 이력"
    >
      <table>
        <caption>최근 테스트 요청 · 최대 20개</caption>
        <thead>
          <tr>
            <th>종류</th>
            <th>상태</th>
            <th>소요 시간</th>
            <th>설정 버전 ID</th>
          </tr>
        </thead>
        <tbody>
          {history.data?.map((r) => (
            <tr key={r.id}>
              <td>{r.kind === 'text' ? '텍스트' : r.kind === 'decision' ? '판정' : '구조화'}</td>
              <td>
                {
                  { running: '진행 중', succeeded: '완료', failed: '실패', interrupted: '중단' }[
                    r.status
                  ]
                }
                {r.error_code && <small>{r.error_code}</small>}
              </td>
              <td>{r.elapsed_ms === null ? '—' : `${r.elapsed_ms} ms`}</td>
              <td>
                <code title={r.config_id}>{r.config_id.slice(0, 8)}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {history.isPending ? (
        <p role="status">이력을 불러옵니다.</p>
      ) : history.isError ? (
        <p role="status">
          {errorMessage(history.error)}{' '}
          <Button variant="ghost" onClick={() => void history.refetch()}>
            다시 시도
          </Button>
        </p>
      ) : (
        !history.data?.length && <p>아직 실행한 테스트가 없습니다.</p>
      )}
    </section>
  );
}
