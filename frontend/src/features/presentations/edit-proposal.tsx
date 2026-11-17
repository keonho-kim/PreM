// Purpose: Present a scoped before/after proposal and explicit acceptance controls in the chat.
// Pattern: Safe text only; successful rendering is distinct from accepting a proposal.
// Usage: SlideChat supplies immutable edit data and shared command state.
// Related: edit-api.ts, slide-chat.tsx, presentation revision history.
import { WorkflowStages } from '@/shared/ui/workflow-stages';
import { Button } from '@/components/ui/button';
import { QualityStatus } from './quality-status';
import type { Edit } from './edit-api';
export function EditProposal({
  edit,
  current,
  pending,
  onCommand,
}: {
  edit: Edit;
  current: boolean;
  pending: boolean;
  onCommand: (action: 'apply' | 'reject' | 'retry' | 'cancel') => void;
}) {
  const status = edit.status;
  return (
    <div className="slide-edit-proposal">
      <WorkflowStages
        steps={edit.steps}
        status={status}
        name="수정안 준비 단계"
        labels={{ propose: '수정안 작성', render: '미리보기 준비' }}
      />
      <QualityStatus rows={edit.quality} />
      {(edit.targets?.length ?? 0) > 1 && (
        <p role="status">
          {edit.targets?.filter((t) => t.completed).length}/{edit.targets?.length}장 수정안 준비
          {status === 'ready' ? ' · 적용하면 함께 저장됩니다.' : ''}
        </p>
      )}
      {status === 'queued' || status === 'running' ? (
        <>
          <p role="status">
            {status === 'queued'
              ? '수정 순서를 기다리고 있습니다.'
              : edit.targets?.length && edit.targets.every((t) => t.completed)
                ? '장표 미리보기를 준비하고 있습니다.'
                : '선택한 내용을 바탕으로 수정안을 작성하고 있습니다.'}
          </p>
          <Button variant="ghost" disabled={pending} onClick={() => onCommand('cancel')}>
            수정 요청 취소
          </Button>
        </>
      ) : null}
      {status === 'ready' && (
        <p>
          {edit.preview
            ? '가운데 장표에서 수정안을 확인하세요. 비교 아이콘을 누르고 있으면 이전 모습이 보입니다.'
            : '수정안이 준비됐습니다.'}
        </p>
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
        <p role="status">
          {edit.render_status === 'succeeded'
            ? '새 버전에 반영했습니다.'
            : ['failed', 'cancelled'].includes(edit.render_status ?? '')
              ? '파일 생성을 완료하지 못했습니다. 생성 화면에서 이어서 만들 수 있습니다.'
              : '수정한 내용으로 PPT 파일을 만들고 있습니다.'}
        </p>
      )}
    </div>
  );
}
