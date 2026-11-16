// Purpose: Confirm the exact selected evidence set before choosing a presentation design.
// Pattern: Explicit fingerprint check; zero additional references still requires confirmation.
// Usage: Studio evidence footer; relation selection remains owned by its existing feature.
// Related: api.ts, features/related-documents/.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/shared/api/http';
import { confirmEvidence, presentationKeys, type Preparation } from './api';
export function EvidenceConfirmation({
  project,
  state,
  editable,
  onContinue,
}: {
  project: string;
  state: Preparation;
  editable: boolean;
  onContinue: () => void;
}) {
  const client = useQueryClient();
  const confirm = useMutation({
    mutationFn: () => confirmEvidence(project, state.fingerprint),
    retry: false,
    onSuccess: (s) => {
      client.setQueryData(presentationKeys.preparation(project), s);
      onContinue();
    },
    onError: () =>
      void client.invalidateQueries({ queryKey: presentationKeys.preparation(project) }),
  });
  return (
    <footer className="presentation-confirmation">
      <div>
        <strong>
          {state.selected_count
            ? `${state.selected_count}개 추가 근거 선택`
            : '현재 프로젝트 원본으로 작성'}
        </strong>
        <p className="muted">
          {state.selected_count > 40
            ? 'PPT 생성에 사용할 추가 근거는 40개 이하로 선택해 주세요.'
            : !state.ready
              ? '목차·내용을 먼저 확정하고 선택한 자료의 원본을 확인해 주세요.'
              : '현재 목차와 선택한 근거를 기준으로 발표자료를 준비합니다.'}
        </p>
        {confirm.isError && <p role="alert">{errorMessage(confirm.error)}</p>}
      </div>
      <Button
        disabled={!editable || !state.ready || confirm.isPending}
        onClick={() => confirm.mutate()}
      >
        {confirm.isPending ? '확인 중…' : '근거 확인하고 계속'}
        <ArrowRight aria-hidden="true" />
      </Button>
    </footer>
  );
}
