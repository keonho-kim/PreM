// Purpose: Keep a recoverable product screen when a lazy page chunk fails to load.
// Pattern: Route-level React error boundary; reload retries the failed module request.
// Usage: Wrap the asynchronously loaded Home page below the persistent app header.
// Related: app.tsx, tests/e2e/projects.cjs.
import { Component, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
export class PageBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <main className="container workspace">
          <h1>화면을 불러오지 못했습니다</h1>
          <p role="alert">
            연결 상태를 확인한 후 다시 불러와 주세요. 저장된 프로젝트는 유지됩니다.
          </p>
          <Button onClick={() => window.location.reload()}>화면 다시 불러오기</Button>
        </main>
      );
    return this.props.children;
  }
}
