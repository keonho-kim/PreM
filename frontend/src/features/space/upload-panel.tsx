// Purpose: Render file-level Uppy progress, safe cancellation and explicit retry controls.
// Pattern: Shared shadcn Progress with measured transmission; registration remains a separate state.
// Usage: The global notification panel displays this tab-local queue on demand.
// Related: upload-engine.ts, api.ts, components/ui/progress.tsx.
import { UploadProcessing } from '@/features/document-processing';
import type { UploadTask } from './use-upload-tasks';
import { Check, RotateCcw, X, Trash2, Upload, CircleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Item,
  ItemMedia,
  ItemContent,
  ItemTitle,
  ItemDescription,
  ItemActions,
} from '@/components/ui/item';
import { Progress } from '@/components/ui/progress';
import { sizeLabel } from './api';
import type { UploadEngine } from './upload-engine';
export function UploadPanel({
  engine,
  tasks,
  onClear,
}: {
  engine: UploadEngine;
  tasks: UploadTask[];
  onClear: () => void;
}) {
  if (!tasks.length)
    return (
      <p className="work-panel-empty" role="status">
        남은 작업이 없습니다.
      </p>
    );
  return (
    <section className="space-uploads" aria-label="이 탭의 업로드 목록">
      <header>
        <span className="upload-list-count">{tasks.length}개</span>
        <Button
          variant="ghost"
          disabled={!tasks.some((task) => task.state === 'complete')}
          onClick={onClear}
        >
          <Trash2 aria-hidden="true" />
          완료 항목 정리
        </Button>
      </header>
      <ul>
        {tasks.map((task) => (
          <UploadRow key={task.file.id} task={task} engine={engine} />
        ))}
      </ul>
    </section>
  );
}
function UploadRow({ task, engine }: { task: UploadTask; engine: UploadEngine }) {
  const { file, processing } = task;
  const percent = file.progress.percentage ?? 0,
    done = !!file.progress.uploadComplete;
  const state = file.meta.cancelPending
    ? '취소 결과 확인 중'
    : done
      ? '원본 등록 완료'
      : file.error
        ? '등록 실패'
        : percent >= 100
          ? '서버에서 파일 확인·저장 중'
          : file.progress.uploadStarted
            ? '전송 중'
            : '전송 대기';
  return (
    <Item asChild size="sm" className="space-upload-row">
      <li data-upload-id={file.id}>
        <ItemMedia className="upload-status-icon" aria-hidden="true">
          {done ? (
            <Check size={18} />
          ) : file.error ? (
            <CircleAlert size={18} />
          ) : (
            <Upload size={18} />
          )}
        </ItemMedia>
        <ItemContent>
          <ItemTitle>{file.name}</ItemTitle>
          <ItemDescription>
            {file.meta.kind.startsWith('project-')
              ? '프로젝트 원본'
              : file.meta.kind === 'templates'
                ? '템플릿'
                : '레퍼런스'}{' '}
            · {sizeLabel(file.size ?? 0)}
          </ItemDescription>
          <ItemDescription role="status">
            {state}
            {!done && !file.error && percent < 100 ? ` · ${percent}%` : ''}
          </ItemDescription>
          {!done && !file.error && <Progress aria-label={`${file.name} 전송률`} value={percent} />}
          {processing && typeof file.response?.body?.version === 'number' && (
            <UploadProcessing result={processing} assetVersion={file.response.body.version} />
          )}
          {done && task.state === 'attention' && (
            <Button variant="ghost" onClick={() => engine.uppy.removeFile(file.id)}>
              목록에서 숨기기
            </Button>
          )}
          {(file.error || file.meta.cancelError) && (
            <p role="alert" className="upload-error">
              {file.meta.cancelError || file.error}
            </p>
          )}
        </ItemContent>
        {!done && (
          <ItemActions className="upload-row-actions">
            {file.error && (
              <Button
                variant="secondary"
                size="icon"
                aria-label={`${file.name} 다시 시도`}
                title="다시 시도"
                disabled={file.meta.cancelPending}
                onClick={() => {
                  void engine.retry(file.id).catch(() => {});
                }}
              >
                <RotateCcw aria-hidden="true" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              aria-label={`${file.name} 업로드 취소`}
              title="업로드 취소"
              disabled={file.meta.cancelPending}
              onClick={() => {
                void engine.cancel(file.id);
              }}
            >
              <X aria-hidden="true" />
            </Button>
          </ItemActions>
        )}
      </li>
    </Item>
  );
}
