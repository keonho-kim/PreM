// Purpose: Present a scoped before/after proposal and explicit acceptance controls in the chat.
// Pattern: Safe text only; successful rendering is distinct from accepting a proposal.
// Usage: SlideChat supplies immutable edit data and shared command state.
// Related: edit-api.ts, slide-chat.tsx, presentation revision history.
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import type { Edit } from './edit-api';
const labels: Record<string, string> = { title: '제목', bullets: '본문', notes: '발표 메모' };
export function EditProposal({
  edit,
  current,
  pending,
  onCommand,
  onResult,
}: {
  edit: Edit;
  current: boolean;
  pending: boolean;
  onCommand: (action: 'apply' | 'reject' | 'retry' | 'cancel') => void;
  onResult: (id: string) => void;
}) {
  const status = edit.status;
  return (
    <div className="slide-edit-proposal">
      {status === 'queued' || status === 'running' ? (
        <>
          <p role="status">
            {status === 'queued'
              ? '수정 순서를 기다리고 있습니다.'
              : '선택한 내용을 바탕으로 수정안을 작성하고 있습니다.'}
          </p>
          <Button variant="ghost" disabled={pending} onClick={() => onCommand('cancel')}>
            수정 요청 취소
          </Button>
        </>
      ) : null}
      {edit.proposal && (
        <Collapsible defaultOpen={status === 'ready'}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost">수정 전후 보기</Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <dl className="slide-edit-difference">
              {edit.fields.map((field) => {
                const before =
                  field === 'title'
                    ? edit.before.title
                    : field === 'bullets'
                      ? edit.before.bullets.join('\n')
                      : edit.before.notes;
                const after =
                  field === 'title'
                    ? edit.proposal?.title
                    : field === 'bullets'
                      ? edit.proposal?.bullets.join('\n')
                      : edit.proposal?.notes;
                return (
                  <div key={field}>
                    <dt>{labels[field]}</dt>
                    <dd>
                      <span>수정 전</span>
                      <p>{before || '없음'}</p>
                      <span>수정 후</span>
                      <p>{after || '없음'}</p>
                    </dd>
                  </div>
                );
              })}
            </dl>
          </CollapsibleContent>
        </Collapsible>
      )}
      {status === 'ready' && (
        <>
          <div className="slide-chat-actions">
            <Button disabled={!current || pending} onClick={() => onCommand('apply')}>
              수정안 적용
            </Button>
            <Button variant="ghost" disabled={pending} onClick={() => onCommand('reject')}>
              적용 안 함
            </Button>
          </div>
          {!current && (
            <p className="field-hint">
              다른 버전이 저장되었습니다. 최신 슬라이드에서 다시 요청해 주세요.
            </p>
          )}
        </>
      )}
      {(status === 'failed' || status === 'cancelled') && (
        <>
          <p role="status">
            {status === 'cancelled'
              ? '수정 요청을 취소했습니다.'
              : '수정안을 완성하지 못했습니다. 기존 슬라이드는 유지됩니다.'}
          </p>
          <Button
            variant="secondary"
            disabled={!current || pending}
            onClick={() => onCommand('retry')}
          >
            다시 요청
          </Button>
        </>
      )}
      {status === 'rejected' && <p className="field-hint">이 수정안은 적용하지 않았습니다.</p>}
      {edit.applied_run_id && (
        <>
          <p role="status">
            {edit.render_status === 'succeeded'
              ? '새 버전에 반영했습니다.'
              : ['failed', 'cancelled'].includes(edit.render_status ?? '')
                ? '파일 생성을 완료하지 못했습니다. 생성 화면에서 이어서 만들 수 있습니다.'
                : '수정한 내용으로 PPT 파일을 만들고 있습니다.'}
          </p>
          <Button
            variant="secondary"
            onClick={() => edit.applied_run_id && onResult(edit.applied_run_id)}
          >
            수정 결과 보기
          </Button>
        </>
      )}
    </div>
  );
}
