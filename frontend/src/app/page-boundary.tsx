// Purpose: Show route load progress and offer recovery when a page fails.
// Pattern: TanStack Router owns the pending and error boundaries.
// Usage: Configured as the router's default pending and error components.
// Related: routing/router.tsx.
import { Button } from '@/components/ui/button';
export function PagePending() {
  return (
    <main className="container workspace">
      <p role="status">화면을 불러오는 중입니다.</p>
    </main>
  );
}
export function PageLoadError() {
  return (
    <main className="container workspace">
      <h1>화면을 불러오지 못했습니다</h1>
      <p role="alert">연결 상태를 확인한 후 다시 불러와 주세요. 저장된 프로젝트는 유지됩니다.</p>
      <Button onClick={() => window.location.reload()}>화면 다시 불러오기</Button>
    </main>
  );
}
