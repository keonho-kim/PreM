// Purpose: Own the application-lifetime Uppy queue, retry keys and server cancellation outcomes.
// Pattern: Uppy owns file/transmission state; Query owns registered assets; no browser persistence.
// Usage: The Space route obtains the lazy shared engine; page exit/HMR releases owned work.
// Related: upload-panel.tsx, api.ts, backend/src/adapters/http/space/uploads.rs.
import Uppy, { type UppyFile } from '@uppy/core';
import XHRUpload from '@uppy/xhr-upload';
import { assetPath, assetSchema, cancelUpload, type Asset, type LibraryKind } from './api';
import { notify } from '@/shared/notifications';
import { errorMessage } from '@/shared/api/http';
type UploadMeta = {
  kind: LibraryKind;
  requestKey: string;
  title: string;
  tags: string;
  targetId?: string;
  expectedVersion?: number;
  cancelPending?: boolean;
  cancelError?: string;
};
type UploadBody = Record<string, unknown>;
export type UploadFile = UppyFile<UploadMeta, UploadBody>;
export function createUploadEngine(onSaved: () => void) {
  const uppy = new Uppy<UploadMeta, UploadBody>({
    autoProceed: true,
    // Separate registrations may intentionally contain identical bytes (including across libraries).
    onBeforeFileAdded: (file) => ({ ...file, id: file.meta.requestKey }),
    restrictions: { maxFileSize: 50 * 1024 * 1024, maxNumberOfFiles: 20 },
    locale: {
      pluralize: () => 0,
      strings: {
        youCanOnlyUploadX: {
          0: '최대 %{smart_count}개까지 등록할 수 있습니다.',
          1: '최대 %{smart_count}개까지 등록할 수 있습니다.',
        },
        exceedsSize: '%{file} 파일이 최대 크기 %{size}를 초과합니다.',
      },
    },
  });
  uppy.use(XHRUpload<UploadMeta, UploadBody>, {
    endpoint: (file) => {
      if (Array.isArray(file)) throw new Error('파일별 업로드만 지원합니다.');
      return `${assetPath(file.meta.kind)}${file.meta.targetId ? `/${file.meta.targetId}/versions` : ''}`;
    },
    fieldName: 'file',
    bundle: false,
    limit: 2,
    timeout: 300_000,
    allowedMetaFields: ['title', 'tags'],
    headers: (file) => ({
      'Idempotency-Key': file.meta.requestKey,
      ...(file.meta.expectedVersion
        ? { 'X-Expected-Version': String(file.meta.expectedVersion) }
        : {}),
    }),
    shouldRetry: () => false,
    onAfterResponse: async (xhr) => {
      if (xhr.status >= 400) {
        let message = '파일 등록에 실패했습니다.';
        try {
          const body = JSON.parse(xhr.responseText) as { message?: unknown };
          if (typeof body.message === 'string') message = body.message;
        } catch {
          /* Keep the public fallback. */
        }
        throw new Error(message);
      }
    },
    getResponseData: (xhr) => assetSchema.parse(JSON.parse(xhr.responseText)),
  });
  uppy.on('upload-success', () => onSaved());
  function add(files: File[], kind: LibraryKind, title: string, tags: string[], target?: Asset) {
    if (!files.length) return;
    if (files.length > 10 || (target && files.length !== 1))
      throw new Error(
        target ? '교체할 파일 한 개를 선택하세요.' : '한 번에 최대 10개 파일을 선택하세요.',
      );
    if (uppy.getFiles().length + files.length > 20)
      throw new Error('대기열은 최대 20개입니다. 완료된 항목을 먼저 정리하세요.');
    for (const file of files) {
      const extension = file.name.split('.').pop()?.toLowerCase();
      if (
        !extension ||
        !(
          kind === 'templates'
            ? ['pptx']
            : ['pdf', 'hwp', 'hwpx', 'docx', 'pptx', 'xlsx', 'html', 'htm', 'md', 'markdown']
        ).includes(extension)
      )
        throw new Error(
          kind === 'templates'
            ? '템플릿은 PPTX 파일만 등록할 수 있습니다.'
            : '지원 형식: PDF, HWP, HWPX, DOCX, PPTX, XLSX, HTML, Markdown',
        );
      if (['md', 'markdown'].includes(extension) && file.size > 2 * 1024 * 1024)
        throw new Error('Markdown은 파일당 최대 2 MiB입니다. 문서를 나눠서 올려주세요.');
      if (!file.size || file.size > 50 * 1024 * 1024)
        throw new Error('빈 파일은 등록할 수 없으며 파일당 최대 50 MiB입니다.');
    }
    for (const file of files)
      uppy.addFile({
        name: file.name,
        type: file.type,
        data: file,
        source: 'Space',
        meta: {
          kind,
          requestKey: crypto.randomUUID(),
          title:
            target?.title ||
            (files.length === 1 && title.trim()
              ? title.trim()
              : Array.from(file.name).slice(0, 120).join('')),
          tags: JSON.stringify(target?.tags ?? tags),
          targetId: target?.id,
          expectedVersion: target?.version,
        },
      });
  }
  async function cancel(id: string) {
    const file = uppy.getFile(id);
    if (!file) return;
    uppy.setFileMeta(id, { ...file.meta, cancelPending: true, cancelError: undefined });
    try {
      const result = await cancelUpload(file.meta.requestKey);
      uppy.removeFile(id);
      if (result.state === 'complete') {
        onSaved();
        notify('이미 등록이 완료된 원본입니다. 목록에서 확인하세요.', 'info');
      }
      return result.state;
    } catch (error) {
      if (uppy.getFile(id))
        uppy.setFileMeta(id, {
          ...file.meta,
          cancelPending: false,
          cancelError: errorMessage(error),
        });
      return 'unknown';
    }
  }
  return {
    uppy,
    add,
    cancel,
    retry: (id: string) => uppy.retryUpload(id),
    dispose: () => uppy.destroy(),
  };
}
export type UploadEngine = ReturnType<typeof createUploadEngine>;
let shared: UploadEngine | undefined;
export function getUploadEngine(onSaved: () => void) {
  if (!shared) {
    shared = createUploadEngine(onSaved);
    const exit = (event: PageTransitionEvent) => {
      if (!event.persisted) {
        shared?.dispose();
        shared = undefined;
        window.removeEventListener('pagehide', exit);
      }
    };
    window.addEventListener('pagehide', exit);
    if (import.meta.hot)
      import.meta.hot.dispose(() => {
        window.removeEventListener('pagehide', exit);
        shared?.dispose();
        shared = undefined;
      });
  }
  return shared;
}
