// Purpose: Register project originals directly from the Studio source step.
// Pattern: Native selection and drop use the same validated background uploader.
// Usage: SourcesStage provides its project-scoped registration command.
// Related: sources-stage.tsx, features/space/upload-engine.ts.
import { useId, useRef, useState } from 'react';
import { FileUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';

export function SourceUpload({
  onUpload,
  empty,
}: {
  onUpload: (files: File[], title: string) => void;
  empty: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  function register(files: File[]) {
    if (!files.length) return;
    try {
      onUpload(files, title);
      setTitle('');
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '파일을 등록하지 못했습니다.');
    }
  }
  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: The file picker also handles keyboard selection.
    <section
      className={'studio-upload' + (empty ? ' studio-empty' : '')}
      aria-label="원본 등록"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        register(Array.from(event.dataTransfer.files));
      }}
    >
      <div>
        <h3>{empty ? '첫 원본 문서를 추가하세요' : '원본 문서 추가'}</h3>
        <p className="muted" id={id}>
          파일을 선택하거나 여기에 놓으면 등록 후 백그라운드에서 읽습니다.
        </p>
      </div>
      <input
        hidden
        type="file"
        multiple
        ref={input}
        aria-label="등록할 원본 파일"
        accept=".pdf,.hwp,.hwpx,.docx,.pptx,.xlsx,.html,.htm,.md,.markdown"
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = '';
          register(files);
        }}
      />
      <Button aria-describedby={id} onClick={() => input.current?.click()}>
        <FileUp aria-hidden="true" />
        문서 추가
      </Button>
      <Collapsible className="studio-upload-options">
        <CollapsibleTrigger asChild>
          <Button variant="ghost">파일 형식·이름 설정</Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <p className="field-hint">
            PDF · HWP · HWPX · DOCX · PPTX · XLSX · HTML · Markdown. 한 번에 10개, 파일당 50 MiB까지
            등록합니다. Markdown은 2 MiB까지 지원합니다.
          </p>
          <Label htmlFor={id + '-title'}>자료 이름 (선택 · 한 파일에 적용)</Label>
          <Input
            id={id + '-title'}
            maxLength={120}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="비워두면 파일 이름을 사용합니다"
          />
        </CollapsibleContent>
      </Collapsible>
      {error && (
        <p role="alert" className="space-error">
          {error}
        </p>
      )}
    </section>
  );
}
