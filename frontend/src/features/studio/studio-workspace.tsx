// Purpose: Deliver project originals from upload through explicit review and optional direction.
// Pattern: URL owns selected step; Query owns persisted project/file/review state; Uppy owns uploads.
// Usage: StudioPage selects a project and mounts this workspace by stable project ID.
// Related: source-card.tsx, direction.tsx, features/space/, features/document-processing/.
import { useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Plus, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { SourceRemoveDialog } from './source-remove-dialog';
import { getProject, listProjects, defaultFilters } from '@/features/projects';
import {
  listAssets,
  removeAsset,
  useUploadEngine,
  UploadDialog,
  VersionDialog,
  type Asset,
  type LibraryKind,
} from '@/features/space';
import { ProcessingDialog } from '@/features/document-processing';
import { errorMessage } from '@/shared/api/http';
import { SourceCard, type SourceAction } from './source-card';
import { Direction } from './direction';
import { StudioStepper, type StudioStep } from './stepper';
import { OutlineWorkspace, getOutline, outlineKeys } from '@/features/outlines';
import { getPreparation, presentationKeys } from '@/features/presentations';
import { PresentationStages } from './presentation-stages';
import { getReview, confirmSources, getGuide, studioKeys } from './api';
import './studio.css';
import '@/features/space/space.css';
type Session = { action: SourceAction; item: Asset; trigger: HTMLElement };
export function StudioWorkspace({ projectId }: { projectId: string }) {
  const navigate = useNavigate(),
    client = useQueryClient(),
    engine = useUploadEngine();
  const [params, setParams] = useSearchParams();
  const [offset, setOffset] = useState(0),
    [upload, setUpload] = useState(false),
    [guideDirty, setGuideDirty] = useState(false),
    [outlineDirty, setOutlineDirty] = useState(false),
    [session, setSession] = useState<Session | null>(null);
  const kind: LibraryKind = `project-${projectId}`;
  const project = useQuery({
    queryKey: ['projects', projectId],
    queryFn: () => getProject(projectId),
    retry: false,
    refetchInterval: 15000,
  });
  const choices = useQuery({
    queryKey: ['projects', 'studio-choices'],
    queryFn: ({ signal }) => listProjects({ ...defaultFilters, status: 'all' }, 0, signal),
  });
  const files = useQuery({
    queryKey: studioKeys.files(projectId, offset),
    queryFn: ({ signal }) => listAssets(kind, '', 'active', offset, signal),
    refetchInterval: 2000,
  });
  const review = useQuery({
    queryKey: studioKeys.review(projectId),
    queryFn: ({ signal }) => getReview(projectId, signal),
    refetchInterval: 2000,
  });
  const guide = useQuery({
    queryKey: studioKeys.guide(projectId),
    queryFn: ({ signal }) => getGuide(projectId, signal),
  });
  const outline = useQuery({
    queryKey: outlineKeys.state(projectId),
    queryFn: ({ signal }) => getOutline(projectId, undefined, signal),
    enabled: !!review.data?.confirmed,
    refetchInterval: 2000,
  });
  const preparation = useQuery({
    queryKey: presentationKeys.preparation(projectId),
    queryFn: ({ signal }) => getPreparation(projectId, signal),
    refetchInterval: 2000,
  });
  const dirty = guideDirty || outlineDirty;
  const confirm = useMutation({
    mutationFn: () => confirmSources(projectId, review.data?.snapshot ?? ''),
    retry: false,
    onSuccess: (value) => {
      client.setQueryData(studioKeys.review(projectId), value);
      setParams({ step: 'guide' });
    },
    onError: () => void review.refetch(),
  });
  const remove = useMutation({
    mutationFn: (item: Asset) => removeAsset(kind, item),
    retry: false,
    onSuccess: () => {
      setSession(null);
      void client.invalidateQueries({ queryKey: studioKeys.all });
    },
  });
  const editable = project.data?.status === 'active';
  const step: StudioStep = ['evidence', 'related'].includes(params.get('step') ?? '')
    ? 'evidence'
    : params.get('step') === 'template'
      ? 'template'
      : params.get('step') === 'generation'
        ? 'generation'
        : params.get('step') === 'outline'
          ? 'outline'
          : params.get('step') === 'guide'
            ? 'guide'
            : 'sources';
  const onAction = (action: SourceAction, item: Asset, trigger: HTMLElement) => {
    remove.reset();
    setSession({ action, item, trigger });
  };
  if (project.isPending)
    return (
      <main className="container workspace">
        <h1>Studio</h1>
        <p role="status">프로젝트를 불러옵니다.</p>
      </main>
    );
  if (project.isError)
    return (
      <main className="container workspace">
        <h1>프로젝트를 열 수 없습니다</h1>
        <p role="alert">{errorMessage(project.error)}</p>
        <Button variant="secondary" onClick={() => void project.refetch()}>
          다시 시도
        </Button>{' '}
        <Link to="/">Home으로</Link>
      </main>
    );
  const options = choices.data?.items.filter((p) => p.id !== projectId) ?? [];
  return (
    <main className="container workspace studio-workspace" data-step={step}>
      <title>{project.data.name} · Studio | PreM</title>
      <header className="studio-heading">
        <div className="sr-only">
          <p className="muted">Studio</p>
          <h1 tabIndex={-1}>{project.data.name}</h1>
        </div>
        <Select
          value={projectId}
          disabled={dirty}
          onValueChange={(id) => navigate(`/studio/${id}`)}
        >
          <SelectTrigger aria-label="프로젝트 선택">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={projectId}>{project.data.name}</SelectItem>
            {options.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </header>
      <StudioStepper
        step={step}
        source={!!review.data?.confirmed}
        guide={!!review.data?.confirmed && !!guide.data?.version && !guideDirty}
        outline={!!review.data?.confirmed && !!outline.data?.confirmed && !outlineDirty}
        dirty={guideDirty}
        unsavedOutline={outlineDirty}
        evidence={!!preparation.data?.evidence_review_id}
        template={!!preparation.data?.design_id}
        manualEntry
        generated={!!preparation.data?.generated}
        onSelect={(value) => setParams(value === 'sources' ? {} : { step: value })}
      />
      <PresentationStages
        project={projectId}
        name={project.data.name}
        blank={params.get('start') === 'blank'}
        step={step}
        preparation={preparation}
        ready={!!review.data?.ready}
        editable={editable}
        onContinue={(step) => setParams({ step })}
      />
      {!editable && (
        <p role="status">
          보관된 프로젝트입니다. Home에서 복원하면 문서를 추가하거나 수정할 수 있습니다.
        </p>
      )}
      {review.isError && (
        <p role="alert">
          {errorMessage(review.error)}{' '}
          <Button variant="secondary" onClick={() => void review.refetch()}>
            다시 시도
          </Button>
        </p>
      )}
      {params.get('step') === 'guide' && !review.data?.confirmed && !review.isPending && (
        <p role="status">원본 목록이 변경되었습니다. 현재 문서를 다시 확인해 주세요.</p>
      )}
      <section hidden={step !== 'sources'} aria-label="프로젝트 원본">
        <header className="studio-section-heading">
          <div>
            <h2>발표의 바탕이 될 문서</h2>
            <p className="muted">이 프로젝트에 필요한 원본을 추가하고 내용을 확인하세요.</p>
          </div>
          <Button disabled={!editable} onClick={() => setUpload(true)}>
            <Plus aria-hidden="true" />
            문서 추가
          </Button>
        </header>
        {files.isPending ? (
          <p role="status">원본 목록을 불러옵니다.</p>
        ) : files.isError ? (
          <p role="alert">
            {errorMessage(files.error)}{' '}
            <Button variant="secondary" onClick={() => void files.refetch()}>
              다시 시도
            </Button>
          </p>
        ) : files.data.items.length ? (
          <div className="studio-source-grid">
            {files.data.items.map((item) => (
              <SourceCard key={item.id} item={item} editable={editable} onAction={onAction} />
            ))}
          </div>
        ) : (
          <div className="studio-empty">
            <h3>첫 원본 문서를 추가하세요</h3>
            <Button
              variant="secondary"
              onClick={() => setParams({ step: 'generation', start: 'blank' })}
            >
              빈 장표로 직접 작성
            </Button>
            <p>PDF · HWP · HWPX · DOCX · PPTX · XLSX · HTML · Markdown을 사용할 수 있습니다.</p>
            <p className="muted">공용 레퍼런스와 템플릿은 Space에서 관리합니다.</p>
          </div>
        )}
        {!!files.data && files.data.total > 12 && (
          <div className="studio-page-controls">
            <Button variant="secondary" disabled={!offset} onClick={() => setOffset(offset - 12)}>
              이전
            </Button>
            <span>
              {offset / 12 + 1} / {Math.ceil(files.data.total / 12)}
            </span>
            <Button
              variant="secondary"
              disabled={offset + 12 >= files.data.total}
              onClick={() => setOffset(offset + 12)}
            >
              다음
            </Button>
          </div>
        )}
        <footer className="studio-review">
          <div>
            <strong>
              {review.data?.confirmed ? '원본 확인 완료' : `${review.data?.count ?? 0}개 원본`}
            </strong>
            <p className="muted">문서를 추가하거나 교체하면 다시 확인해야 합니다.</p>
            {confirm.isError && <p role="alert">{errorMessage(confirm.error)}</p>}
          </div>
          <Button
            disabled={!editable || !review.data?.ready || confirm.isPending || review.isError}
            onClick={() => confirm.mutate()}
          >
            {confirm.isPending ? '확인 중…' : '원본 확인하고 계속'}
            <ArrowRight aria-hidden="true" />
          </Button>
        </footer>
      </section>
      <section hidden={step !== 'guide'} aria-label="작성 방향">
        <Direction
          project={projectId}
          editable={editable}
          onDirty={setGuideDirty}
          onContinue={() => setParams({ step: 'outline' })}
        />
      </section>
      <section hidden={step !== 'outline'} aria-label="목차·내용">
        <OutlineWorkspace
          project={projectId}
          editable={editable}
          active={step === 'outline'}
          onDirty={setOutlineDirty}
        />
      </section>
      {upload && <UploadDialog kind={kind} engine={engine} onClose={() => setUpload(false)} />}
      {session?.action === 'preview' && (
        <ProcessingDialog
          item={session.item}
          returnFocus={session.trigger}
          onClose={() => setSession(null)}
        />
      )}
      {session?.action === 'replace' && (
        <UploadDialog
          kind={kind}
          target={session.item}
          engine={engine}
          returnFocus={session.trigger}
          onClose={() => setSession(null)}
        />
      )}
      {session?.action === 'versions' && (
        <VersionDialog
          kind={kind}
          item={session.item}
          returnFocus={session.trigger}
          onClose={() => setSession(null)}
        />
      )}
      <SourceRemoveDialog
        open={session?.action === 'remove'}
        title={session?.item.title ?? ''}
        pending={remove.isPending}
        error={remove.isError ? errorMessage(remove.error) : null}
        onClose={() => setSession(null)}
        onRemove={() => {
          if (session) remove.mutate(session.item);
        }}
      />
    </main>
  );
}
