// Purpose: Resolve real proposal/before images and coordinate version-checked deck undo.
// Pattern: Query owns remote state; preview and undo never duplicate canonical slide content.
// Usage: DeckPreview consumes current-slide thread and central toolbar actions.
// Related: history-api.ts, use-edit-thread.ts, comparison-button.tsx.
import { useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { historyKey, getHistory, undoDeck, editPreviewUrl } from './history-api';
import { presentationKeys, previewUrl, type Run, type Slide } from './api';
import { editKeys } from './edit-api';
import type { EditThread } from './use-edit-thread';
export function useDeckReview(
  project: string,
  run: Run,
  slide: Slide | undefined,
  active: boolean,
  canEdit: boolean,
  thread: EditThread,
  session: string | null,
  onResult: (id: string) => void,
) {
  const client = useQueryClient(),
    receipt = useRef<{ stamp: string; key: string } | null>(null);
  const history = useQuery({
    queryKey: historyKey(project, run.id, session),
    queryFn: ({ signal }) => getHistory(project, run.id, session, signal),
    enabled: active && run.status === 'succeeded',
    refetchInterval: active ? 15000 : false,
  });
  const refresh = () => {
    void client.invalidateQueries({ queryKey: presentationKeys.all });
    void client.invalidateQueries({ queryKey: ['presentation-history'] });
    void client.invalidateQueries({ queryKey: editKeys.all });
  };
  const undo = useMutation({
    mutationFn: () => {
      const stamp = `${run.id}:${run.presentation_version}:${session}`;
      if (receipt.current?.stamp !== stamp) receipt.current = { stamp, key: crypto.randomUUID() };
      if (!session) throw Error('editor_session_closed');
      return undoDeck(project, run, receipt.current.key, session);
    },
    retry: false,
    onSuccess: (r) => {
      receipt.current = null;
      client.setQueryData<Run[]>(presentationKeys.runs(project), (rows) => [
        r,
        ...(rows ?? []).filter((v) => v.id !== r.id),
      ]);
      refresh();
      onResult(r.id);
    },
    onError: refresh,
  });
  const proposal = thread.data
    ?.slice()
    .reverse()
    .find(
      (e) => e.status === 'ready' && e.preview && e.base_revision_id === run.id && run.is_current,
    );
  const proposed = proposal?.slides?.find((s) => s.slide_id === slide?.id)?.proposal;
  const previous = history.data?.slides.find((s) => s.slide_id === slide?.id);
  const originalUrl =
    slide?.preview && run.status === 'succeeded' ? previewUrl(project, run.id, slide.id) : null;
  const afterUrl = proposal && slide ? editPreviewUrl(project, proposal.id, slide.id) : originalUrl;
  const beforeUrl = proposal
    ? originalUrl
    : history.data?.before_run_id && previous
      ? previewUrl(project, history.data.before_run_id, previous.before_slide_id)
      : null;
  const busy =
    thread.data?.some(
      (e) => ['queued', 'running', 'applying'].includes(e.status) && e.base_revision_id === run.id,
    ) ?? false;
  return {
    history,
    undo,
    proposal,
    proposed,
    afterUrl,
    beforeUrl,
    undoRemaining: history.data?.undo_remaining ?? 0,
    canUndo:
      !!session &&
      canEdit &&
      run.is_current &&
      run.status === 'succeeded' &&
      !proposal &&
      !busy &&
      !undo.isPending,
    refresh,
  };
}
