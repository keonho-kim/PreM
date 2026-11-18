// Purpose: Explain the redirect before token entry and track the remaining setup afterward.
// Pattern: Only public booleans are read while Admin is locked.
// Usage: Mounted on Admin visits redirected from Home.
// Related: shared/api/model-setup.ts, admin-page.tsx.
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { getModelSetup, modelSetupKey } from '@/shared/api/model-setup';

export function ModelSetupNotice() {
  const setup = useQuery({
    queryKey: modelSetupKey,
    queryFn: ({ signal }) => getModelSetup(signal),
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const missing =
    setup.data &&
    [!setup.data.llm && 'LLM', !setup.data.decision && 'Decision'].filter(Boolean).join('과 ');
  return (
    <div className="container model-setup-notice" role="status">
      {setup.isError ? (
        <>
          모델 설정 상태를 확인하지 못했습니다.{' '}
          <Button variant="secondary" onClick={() => void setup.refetch()}>
            다시 확인
          </Button>
        </>
      ) : setup.isPending ? (
        '모델 설정 상태를 확인하고 있습니다.'
      ) : missing ? (
        `${missing} 모델이 아직 설정되지 않았습니다. Admin에서 연결 설정을 완료해 주세요.`
      ) : (
        <>
          모델 설정이 완료되었습니다. <Link to="/">Home으로 이동</Link>
        </>
      )}
    </div>
  );
}
