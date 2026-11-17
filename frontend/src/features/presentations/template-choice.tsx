// Purpose: Select a real processed template or the built-in clean presentation design.
// Pattern: Passive previews stay separate from explicit version-checked selection.
// Usage: Studio template step; uploads and library lifecycle remain in Space.
// Related: api.ts, features/document-processing/, features/space/.
import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Check, ArrowRight, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { listAssets, type Asset } from '@/features/space';
import { ProcessingDialog, getDetail, fileUrl } from '@/features/document-processing';
import { errorMessage } from '@/shared/api/http';
import { saveDesign, presentationKeys, type Preparation } from './api';
export function TemplateChoice({
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
  const [offset, setOffset] = useState(0),
    [chosen, setChosen] = useState<string | null | undefined>(undefined);
  const client = useQueryClient();
  const assets = useQuery({
    queryKey: ['space', 'presentation-templates', offset],
    queryFn: ({ signal }) => listAssets('templates', '', 'active', offset, signal),
    refetchInterval: 10000,
  });
  const selection = chosen === undefined ? state.template_job_id : chosen;
  const save = useMutation({
    mutationFn: () => saveDesign(project, state, selection),
    retry: false,
    onSuccess: (s) => {
      client.setQueryData(presentationKeys.preparation(project), s);
      onContinue();
    },
    onError: () =>
      void client.invalidateQueries({ queryKey: presentationKeys.preparation(project) }),
  });
  return (
    <section className="presentation-step" aria-label="템플릿 선택">
      <header>
        <div>
          <h2>발표자료의 디자인을 선택하세요</h2>
          <p className="muted">
            기본 디자인 또는 Space에 준비된 템플릿의 마스터·텍스트 레이아웃을 적용합니다.
          </p>
        </div>
        <Button asChild variant="secondary">
          <Link to="/space/library?tab=templates">템플릿 관리</Link>
        </Button>
      </header>
      {!state.evidence_review_id && (
        <p role="status">근거 단계에서 사용할 자료를 먼저 확인하세요.</p>
      )}
      <div className="presentation-template-grid">
        <article className="presentation-template" data-selected={selection === null}>
          <div className="presentation-template-paper">
            <span>PreM</span>
            <strong>
              명확한 제목,
              <br />
              읽기 쉬운 내용
            </strong>
            <span>기본 디자인</span>
          </div>
          <h3>기본 디자인</h3>
          <p>밝은 배경과 편집 가능한 제목·본문</p>
          <Button
            variant="secondary"
            aria-pressed={selection === null}
            onClick={() => setChosen(null)}
          >
            {selection === null ? <Check aria-hidden="true" /> : null}기본 디자인 선택
          </Button>
        </article>
        {assets.data?.items.map((item) => (
          <TemplateCard key={item.id} item={item} selected={selection} onSelect={setChosen} />
        ))}
      </div>
      {assets.isPending && <p role="status">템플릿을 불러옵니다.</p>}
      {assets.isError && (
        <p role="alert">
          {errorMessage(assets.error)}{' '}
          <Button variant="secondary" onClick={() => void assets.refetch()}>
            다시 시도
          </Button>
        </p>
      )}
      {assets.data?.total === 0 && (
        <p className="muted">등록된 템플릿이 없습니다. 기본 디자인으로 바로 만들 수 있습니다.</p>
      )}
      {!!assets.data && assets.data.total > 12 && (
        <div className="related-pagination">
          <Button variant="secondary" disabled={!offset} onClick={() => setOffset(offset - 12)}>
            이전
          </Button>
          <span>
            {offset / 12 + 1} / {Math.ceil(assets.data.total / 12)}
          </span>
          <Button
            variant="secondary"
            disabled={offset + 12 >= assets.data.total}
            onClick={() => setOffset(offset + 12)}
          >
            다음
          </Button>
        </div>
      )}
      {save.isError && <p role="alert">{errorMessage(save.error)}</p>}
      <footer className="presentation-confirmation">
        <p>원본 템플릿과 이전 생성물은 그대로 보존합니다.</p>
        <Button
          disabled={!editable || !state.evidence_review_id || save.isPending}
          onClick={() => save.mutate()}
        >
          이 디자인으로 계속
          <ArrowRight aria-hidden="true" />
        </Button>
      </footer>
    </section>
  );
}
function TemplateCard({
  item,
  selected,
  onSelect,
}: {
  item: Asset;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const [preview, setPreview] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const detail = useQuery({
    queryKey: ['processing', 'template-choice', item.id, item.file_version],
    queryFn: ({ signal }) => getDetail('templates', item.id, undefined, signal),
    enabled: item.processing === 'succeeded',
  });
  const job = detail.data?.job.id,
    thumbnail = detail.data?.template?.previews[0];
  return (
    <article className="presentation-template" data-selected={!!job && selected === job}>
      <Button
        ref={trigger}
        type="button"
        className="presentation-template-preview"
        aria-label={`${item.title} 미리보기`}
        onClick={() => setPreview(true)}
      >
        {thumbnail && job ? (
          <img src={fileUrl(job, thumbnail.sha256)} alt="" loading="lazy" />
        ) : (
          <FileText aria-hidden="true" />
        )}
      </Button>
      <h3>{item.title}</h3>
      <p>
        버전 {item.file_version} ·{' '}
        {item.processing === 'succeeded' ? '준비 완료' : '준비 중 또는 처리 확인 필요'}
      </p>
      <Button
        variant="secondary"
        disabled={!job || !thumbnail}
        aria-pressed={!!job && selected === job}
        onClick={() => job && onSelect(job)}
      >
        {job && selected === job ? <Check aria-hidden="true" /> : null}이 템플릿 선택
      </Button>
      {detail.isError && (
        <Button variant="ghost" onClick={() => void detail.refetch()}>
          미리보기 다시 불러오기
        </Button>
      )}
      {preview && (
        <ProcessingDialog
          item={item}
          returnFocus={trigger.current ?? undefined}
          onClose={() => setPreview(false)}
        />
      )}
    </article>
  );
}
