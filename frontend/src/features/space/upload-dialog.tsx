// Purpose: Collect real local files and metadata before giving them to Uppy.
// Pattern: shadcn form/dialog; native file selection and drop events are UI adapters only.
// Usage: Space creation and immutable file replacement share this input boundary.
// Related: upload-engine.ts, metadata-dialog.tsx, api.ts.
import { useId, useRef, useState } from 'react';
import { UploadCloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { metadataSchema, parseTags, sizeLabel, type Asset, type LibraryKind } from './api';
import type { UploadEngine } from './upload-engine';
export function UploadDialog({
  kind,
  target,
  engine,
  onClose,
  returnFocus,
}: {
  kind: LibraryKind;
  target?: Asset;
  engine: UploadEngine;
  onClose: () => void;
  returnFocus?: HTMLElement;
}) {
  const projectSource = kind.startsWith('project-');
  const id = useId(),
    input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<{ id: string; file: File }[]>([]),
    [title, setTitle] = useState(''),
    [tags, setTags] = useState(''),
    [error, setError] = useState('');
  const accept =
    kind === 'templates' ? '.pptx' : '.pdf,.hwp,.hwpx,.docx,.pptx,.xlsx,.html,.htm,.md,.markdown';
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="space-dialog"
        onInteractOutside={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          (returnFocus?.isConnected
            ? returnFocus
            : document.querySelector<HTMLElement>('main h1')
          )?.focus();
        }}
      >
        <DialogTitle>
          {target
            ? '새 파일 버전 등록'
            : kind === 'templates'
              ? '템플릿 올리기'
              : projectSource
                ? '원본 문서 추가'
                : '레퍼런스 올리기'}
        </DialogTitle>
        <DialogDescription>
          {target
            ? `${target.title}의 원본을 덮어쓰지 않고 새 버전으로 추가합니다.`
            : projectSource
              ? '이 프로젝트에서 사용할 원본입니다. Space 공용 자료에는 등록되지 않습니다.'
              : '팀 전체가 공유하는 자료입니다. 프로젝트 원본에 자동 등록되지 않습니다.'}
        </DialogDescription>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            try {
              const parsed = metadataSchema.safeParse({
                title: title.trim() || '자료',
                tags: parseTags(tags),
              });
              if (!parsed.success) {
                setError(parsed.error.issues[0]?.message ?? '입력 값을 확인하세요.');
                return;
              }
              if (!files.length) {
                setError('파일을 선택하세요.');
                return;
              }
              engine.add(
                files.map((entry) => entry.file),
                kind,
                title,
                parsed.data.tags,
                target,
              );
              onClose();
            } catch (error) {
              setError(error instanceof Error ? error.message : '파일을 등록하지 못했습니다.');
            }
          }}
        >
          {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: This drop surface supplements the labeled file input; keyboard users use that native input. */}
          <section
            className="space-dropzone"
            aria-label="등록할 파일"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              setFiles(
                Array.from(event.dataTransfer.files, (file) => ({ id: crypto.randomUUID(), file })),
              );
              setError('');
            }}
          >
            <UploadCloud aria-hidden="true" />
            <p>파일을 이곳에 놓거나 선택하세요</p>
            <Input
              ref={input}
              id={`${id}-files`}
              type="file"
              aria-label="등록할 파일 선택"
              aria-describedby={`${id}-format-hint`}
              multiple={!target}
              accept={accept}
              onChange={(event) => {
                setFiles(
                  Array.from(event.target.files ?? [], (file) => ({
                    id: crypto.randomUUID(),
                    file,
                  })),
                );
                setError('');
              }}
            />
            <p className="field-hint" id={`${id}-format-hint`}>
              {kind === 'templates'
                ? 'PPTX'
                : 'PDF · HWP · HWPX · DOCX · PPTX · XLSX · HTML · Markdown'}{' '}
              · {kind === 'templates' ? '파일당 50 MiB' : 'Markdown 2 MiB · 그 외 50 MiB'} ·{' '}
              {target ? '1개' : '한 번에 10개'}
              {kind !== 'templates' && ' · HTML/Markdown은 UTF-8'}
            </p>
          </section>
          {!!files.length && (
            <ul className="space-selected-files">
              {files.map(({ file, id }) => (
                <li key={id}>
                  {file.name}
                  <span>{sizeLabel(file.size)}</span>
                </li>
              ))}
            </ul>
          )}
          {!target && (
            <>
              <Label htmlFor={`${id}-title`}>
                자료 이름 <span className="muted">선택 · 파일 한 개일 때 적용</span>
              </Label>
              <Input
                id={`${id}-title`}
                value={title}
                maxLength={120}
                disabled={files.length > 1}
                placeholder="비워두면 파일 이름을 사용합니다"
                onChange={(event) => setTitle(event.target.value)}
              />
              {!projectSource && (
                <>
                  <Label htmlFor={`${id}-tags`}>
                    태그 <span className="muted">선택 · 쉼표로 구분</span>
                  </Label>
                  <Input
                    id={`${id}-tags`}
                    value={tags}
                    maxLength={320}
                    placeholder="예: 회사 소개, 서비스 사례"
                    onChange={(event) => setTags(event.target.value)}
                  />
                </>
              )}
            </>
          )}
          <p className="space-error" role="status">
            {error}
          </p>
          <div className="dialog-actions">
            <Button variant="secondary" onClick={onClose}>
              취소
            </Button>
            <Button type="submit" disabled={!files.length}>
              업로드 시작
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
