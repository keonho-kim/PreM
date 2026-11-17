// Purpose: Require the startup CLI token before mounting any Admin feature or query.
// Pattern: Ephemeral authorization, cancellable verification and sensitive-cache cleanup on exit.
// Usage: AdminPage wraps its content; public authoring models use their separate safe API.
// Related: shared/api/admin-credential.ts, backend/adapters/http/admin_access.rs.
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, LockKeyhole } from 'lucide-react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { request, errorMessage } from '@/shared/api/http';
import {
  hasAdminAccess,
  subscribeAdminAccess,
  grantAdminAccess,
  clearAdminAccess,
} from '@/shared/api/admin-credential';
import './admin-access.css';
const adminKeys = new Set([
  'admin-general',
  'providers',
  'provider-types',
  'provider-capacity',
  'processing-settings',
  'relation-settings',
]);
export function AdminGate({ children }: { children: ReactNode }) {
  const authorized = useSyncExternalStore(subscribeAdminAccess, hasAdminAccess, () => false);
  const [token, setToken] = useState(''),
    [visible, setVisible] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null),
    field = useRef<HTMLInputElement>(null);
  const client = useQueryClient();
  useEffect(() => {
    if (!authorized) field.current?.focus();
  }, [authorized]);
  useEffect(() => {
    const purge = () => {
      if (hasAdminAccess()) return;
      const filters = {
        predicate: (q: { queryKey: readonly unknown[] }) => adminKeys.has(String(q.queryKey[0])),
      };
      void client.cancelQueries(filters);
      client.removeQueries(filters);
      for (const mutation of client.getMutationCache().getAll()) {
        if (mutation.meta?.admin) client.getMutationCache().remove(mutation);
      }
    };
    const unsubscribe = subscribeAdminAccess(purge);
    const lock = () => {
      controller.current?.abort();
      setToken('');
      setVisible(false);
      setBusy(false);
      setError('');
      clearAdminAccess();
    };
    window.addEventListener('pagehide', lock);
    return () => {
      window.removeEventListener('pagehide', lock);
      controller.current?.abort();
      clearAdminAccess();
      purge();
      unsubscribe();
    };
  }, [client]);
  async function unlock(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const pending = new AbortController();
    controller.current = pending;
    setBusy(true);
    setError('');
    try {
      const value = token.trim();
      await request('/api/v1/admin/access', z.object({ authenticated: z.literal(true) }), {
        method: 'POST',
        headers: { Authorization: `Bearer ${value}` },
        signal: pending.signal,
      });
      if (pending.signal.aborted) return;
      setToken('');
      setVisible(false);
      grantAdminAccess(value);
    } catch (e) {
      if (!pending.signal.aborted) {
        setError(errorMessage(e));
        field.current?.focus();
      }
    } finally {
      if (!pending.signal.aborted) setBusy(false);
    }
  }
  if (authorized) return <>{children}</>;
  return (
    <main className="container workspace">
      <title>Admin 접근 확인 · PreM</title>
      <section className="admin-access-form">
        <LockKeyhole aria-hidden="true" size={28} />
        <h1>Admin 접근 확인</h1>
        <p>서버 실행 터미널의 초기 토큰 또는 일반 설정에서 변경한 토큰을 입력하세요.</p>
        <form onSubmit={unlock} aria-label="Admin 접근 확인">
          <Label htmlFor="admin-token">Admin 토큰</Label>
          <div className="admin-token-input">
            <Input
              ref={field}
              id="admin-token"
              name="admin-token"
              type={visible ? 'text' : 'password'}
              autoComplete="current-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              maxLength={128}
              enterKeyHint="done"
              value={token}
              aria-invalid={!!error}
              aria-describedby="admin-token-help"
              onChange={(e) => {
                setToken(e.target.value);
                setError('');
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={visible ? '토큰 숨기기' : '토큰 표시'}
              aria-pressed={visible}
              onClick={() => setVisible(!visible)}
            >
              {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
            </Button>
          </div>
          <p id="admin-token-help" className="field-hint">
            서버를 다시 시작하면 토큰이 바뀝니다. Admin을 벗어나거나 새로고침하면 다시 입력해야
            합니다.
          </p>
          {error && <p role="alert">{error}</p>}
          <Button type="submit" disabled={busy}>
            {busy ? '확인 중…' : 'Admin 열기'}
          </Button>
        </form>
      </section>
    </main>
  );
}
