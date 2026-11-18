// Purpose: Deliver project originals from upload through explicit review and optional direction.
// Pattern: URL owns selected step; Query owns persisted project/file/review state; Uppy owns uploads.
// Usage: StudioPage selects a project and mounts this workspace by stable project ID.
// Related: source-card.tsx, direction.tsx, features/space/, features/document-processing/.
import { useState } from 'react';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useUrlSearch } from '@/shared/routing/search';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { SourceRemoveDialog } from '../source-remove-dialog';
import {
  removeAsset,
  useUploadEngine,
  UploadDialog,
  VersionDialog,
  type Asset,
} from '@/features/space';
import { ProcessingDialog } from '@/features/document-processing';
import { errorMessage } from '@/shared/api/http';
import type { SourceAction } from '../source-card';
import { Direction } from '../direction';
import { StudioStepper, type StudioStep } from '../stepper';
import { OutlineWorkspace } from '@/features/outlines';
import { PresentationStages } from '../presentation-stages';
import { confirmSources, studioKeys } from '../api';
import '../studio.css';
import '@/features/space/space.css';
import { useWorkspaceData } from './use-workspace-data';
import { SourcesStage } from './sources-stage';
type Session = { action: SourceAction; item: Asset; trigger: HTMLElement };
export function StudioWorkspace({ projectId }: { projectId: string }) {
  const navigate = useNavigate(),
    client = useQueryClient(),
    engine = useUploadEngine();
  const [params, setParams] = useUrlSearch();
  const [offset, setOffset] = useState(0),
    [guideDirty, setGuideDirty] = useState(false),
    [outlineDirty, setOutlineDirty] = useState(false),
    [session, setSession] = useState<Session | null>(null);
  const { kind, project, choices, files, review, guide, outline, preparation } = useWorkspaceData(
    projectId,
    offset,
  );
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
          onValueChange={(id) =>
            void navigate({ to: '/studio/$projectId', params: { projectId: id } })
          }
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
      <SourcesStage
        visible={step === 'sources'}
        editable={editable}
        offset={offset}
        files={files}
        review={review}
        confirm={confirm}
        onOffset={setOffset}
        onUpload={(files, title) => engine.add(files, kind, title, [])}
        onBlank={() => setParams({ step: 'generation', start: 'blank' })}
        onAction={onAction}
      />
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
