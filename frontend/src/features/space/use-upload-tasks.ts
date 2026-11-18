// Purpose: Track transmission and the registered file version's server job as one task.
// Pattern: Uppy owns uploads and Query polls the corresponding jobs even while the panel is closed.
// Usage: The work panel and its cleanup action use the same task state.
// Related: upload-work-panel.tsx, upload-panel.tsx, features/document-processing/.
import { useQueries, type UseQueryResult } from '@tanstack/react-query';
import { useUppyState } from '@uppy/react';
import { uploadJobOptions, type ProcessingJob } from '@/features/document-processing';
import type { UploadEngine, UploadFile } from './upload-engine';

export type UploadTask = {
  file: UploadFile;
  processing?: UseQueryResult<ProcessingJob | null>;
  state: 'active' | 'complete' | 'attention';
};

export function useUploadTasks(engine: UploadEngine): UploadTask[] {
  const files = useUppyState(engine.uppy, (state) => Object.values(state.files));
  const registrations = files.flatMap((file) => {
    const body = file.response?.body;
    return file.progress.uploadComplete &&
      typeof body?.id === 'string' &&
      typeof body.file_version === 'number'
      ? [{ fileId: file.id, options: uploadJobOptions(file.meta.kind, body.id, body.file_version) }]
      : [];
  });
  const queries = useQueries({ queries: registrations.map((entry) => entry.options) });
  const results = new Map(registrations.map((entry, index) => [entry.fileId, queries[index]]));
  return files.map((file) => {
    const processing = results.get(file.id);
    const status = processing?.data?.status;
    let state: UploadTask['state'] = 'active';
    if (
      file.error ||
      processing?.isError ||
      status === 'failed' ||
      status === 'cancelled' ||
      status === 'waiting_configuration'
    )
      state = 'attention';
    else if (status === 'succeeded') state = 'complete';
    return { file, processing, state };
  });
}
