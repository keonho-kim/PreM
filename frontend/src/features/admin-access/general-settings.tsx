// Purpose: Change the current process's Admin token without affecting public services or persistence.
// Pattern: Version-checked mutation and explicit confirmation; successful rotation locks Admin.
// Usage: Admin general settings; restarting always replaces this token with a new CLI random token.
// Related: admin-gate.tsx, backend/adapters/http/admin_access.rs.
import { useRef, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { request, errorMessage } from '@/shared/api/http';
import { notify } from '@/shared/notifications';
import { clearAdminAccess } from '@/shared/api/admin-credential';
const schema = z.object({ version: z.number() });
export function GeneralSettings() {
  const [token, setToken] = useState(''),
    [repeat, setRepeat] = useState(''),
    [error, setError] = useState(''),
    [review, setReview] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const settings = useQuery({
    queryKey: ['admin-general'],
    queryFn: ({ signal }) => request('/api/v1/admin/general', schema, { signal }),
  });
  const save = useMutation({
    meta: { admin: true },
    retry: false,
    mutationFn: () =>
      request('/api/v1/admin/general', schema, {
        method: 'PUT',
        body: JSON.stringify({ expected_version: settings.data?.version, token }),
      }),
    onSuccess: () => {
      notify('Admin 토큰을 변경했습니다. 새 토큰으로 다시 진입하세요.');
      setToken('');
      setRepeat('');
      setReview(false);
      clearAdminAccess();
    },
    onError: () => {
      setReview(false);
      void settings.refetch();
    },
  });
  return (
    <section className="admin-general">
      <title>일반 설정 · Admin | PuPuTyX</title>
      <header>
        <p className="muted">Admin</p>
        <h1 tabIndex={-1}>일반 설정</h1>
      </header>
      <div>
        <h2>Admin 토큰 변경</h2>
        <p>
          초기에는 서버 실행 터미널의 임의 토큰으로 진입합니다. 여기서 변경한 토큰은 현재 서버가
          실행되는 동안만 사용합니다.
        </p>
        <p className="field-hint">
          서버를 재시작하면 변경한 토큰은 사라지고 새 임의 토큰으로 처음부터 진입합니다.
          프로젝트·Studio·Space 이용과 진행 중인 작업에는 영향을 주지 않습니다.
        </p>
      </div>
      {settings.isPending ? (
        <p role="status">설정을 확인합니다.</p>
      ) : settings.isError ? (
        <p role="alert">
          {errorMessage(settings.error)}{' '}
          <Button variant="secondary" onClick={() => void settings.refetch()}>
            다시 시도
          </Button>
        </p>
      ) : (
        <form
          aria-label="Admin 토큰 변경"
          onSubmit={(e) => {
            e.preventDefault();
            setError('');
            if (token !== repeat) {
              setError('두 입력이 일치하지 않습니다. 새 토큰을 다시 확인하세요.');
              field.current?.focus();
              return;
            }
            if (token.length < 12 || token.length > 128 || !/^[\x21-\x7e]+$/.test(token)) {
              setError('공백 없이 영문·숫자·기호 12~128자로 입력하세요.');
              field.current?.focus();
              return;
            }
            setReview(true);
          }}
        >
          <Label htmlFor="admin-new-token">새 Admin 토큰</Label>
          <Input
            ref={field}
            id="admin-new-token"
            type="password"
            autoComplete="new-password"
            autoCapitalize="none"
            spellCheck={false}
            required
            minLength={12}
            maxLength={128}
            value={token}
            onChange={(e) => {
              setToken(e.target.value);
              setError('');
            }}
            aria-describedby="admin-new-token-help"
          />
          <p id="admin-new-token-help" className="field-hint">
            공백 없이 영문·숫자·기호 12~128자
          </p>
          <Label htmlFor="admin-repeat-token">새 토큰 확인</Label>
          <Input
            id="admin-repeat-token"
            type="password"
            autoComplete="new-password"
            autoCapitalize="none"
            spellCheck={false}
            required
            minLength={12}
            maxLength={128}
            value={repeat}
            onChange={(e) => {
              setRepeat(e.target.value);
              setError('');
            }}
          />
          {error && <p role="alert">{error}</p>}
          {save.isError && <p role="alert">{errorMessage(save.error)}</p>}
          <Button type="submit" disabled={save.isPending}>
            Admin 토큰 변경
          </Button>
        </form>
      )}
      <AlertDialog
        open={review}
        onOpenChange={(value) => {
          if (!save.isPending) setReview(value);
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>Admin 토큰을 변경할까요?</AlertDialogTitle>
          <AlertDialogDescription>
            이전 토큰은 더 이상 사용할 수 없습니다. 현재 Admin 화면이 잠기며 새 토큰으로 다시
            진입해야 합니다. 다른 서비스와 작업은 계속 이용할 수 있습니다.
          </AlertDialogDescription>
          <div className="dialog-actions">
            <AlertDialogCancel disabled={save.isPending}>취소</AlertDialogCancel>
            <AlertDialogAction
              disabled={save.isPending}
              onClick={(e) => {
                e.preventDefault();
                save.mutate();
              }}
            >
              확인하고 변경
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
