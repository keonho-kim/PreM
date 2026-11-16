// Purpose: Show real server reachability and version to Admin and the legacy status page.
// Pattern: Query-owned health data with cancellation, error and explicit retry.
// Usage: Compose inside a page; this feature does not own navigation or a main landmark.
// Related: lib/api.ts, pages/admin-page.tsx, pages/home-page.tsx.
import { useQuery } from '@tanstack/react-query';
import { CircleCheck, CircleAlert, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getHealth } from '@/lib/api';
export function ServiceStatus() {
  const health = useQuery({ queryKey: ['system', 'health'], queryFn: getHealth });
  return (
    <section className="connection">
      <div className="connection-heading">
        <h2>서비스 연결</h2>
        <Button
          onClick={() => void health.refetch()}
          disabled={health.isFetching}
          aria-busy={health.isFetching}
        >
          <RefreshCw aria-hidden="true" size={16} />
          연결 확인
        </Button>
      </div>
      {health.isPending && <p className="muted">서버 연결을 확인하고 있습니다.</p>}
      <p role="status" className={health.isError ? 'status-error' : 'status-message'}>
        {health.isError ? (
          <>
            <CircleAlert aria-hidden="true" size={20} />
            서버에 연결할 수 없습니다. 잠시 후 다시 확인해 주세요.
          </>
        ) : health.data ? (
          <>
            <CircleCheck aria-hidden="true" size={20} />
            서버에 연결되었습니다.
          </>
        ) : null}
      </p>
      {health.data && (
        <dl className="system-details">
          <div>
            <dt>서비스</dt>
            <dd>{health.data.service}</dd>
          </div>
          <div>
            <dt>버전</dt>
            <dd className="num">{health.data.version}</dd>
          </div>
        </dl>
      )}
    </section>
  );
}
