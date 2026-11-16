// Purpose: Preserve the existing standalone service connection route.
// Pattern: Legacy page shell reuses the same health feature as Admin.
// Usage: /home/system and existing health behavior tests.
// Related: features/system-status/, pages/admin-page.tsx.
import { ServiceStatus } from '@/features/system-status';
export function HomePage() {
  return (
    <main className="container workspace">
      <title>PuPuTyX</title>
      <div className="workspace-intro">
        <h1>문서에서 프레젠테이션까지</h1>
        <p>원문을 분석하고, 근거를 연결하고, 편집 가능한 슬라이드를 만듭니다.</p>
      </div>
      <ServiceStatus />
    </main>
  );
}
