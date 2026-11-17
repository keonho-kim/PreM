// Purpose: Own one shared query for the current slide's durable editing conversation.
// Pattern: Canvas and chat consume one observer; versioned keys prevent cross-slide state leaks.
// Usage: DeckPreview queries once and passes the read model to its inspector.
// Related: edit-api.ts, slide-chat.tsx, use-deck-review.ts.
import { useQuery } from '@tanstack/react-query';
import { editKeys, getEdits } from './edit-api';
import type { Run, Slide } from './api';
export function useEditThread(
  project: string,
  run: Run,
  slide: Slide | undefined,
  active: boolean,
) {
  return useQuery({
    queryKey: editKeys.thread(project, run.id, slide?.id ?? ''),
    queryFn: ({ signal }) => getEdits(project, run.id, slide?.id ?? '', signal),
    enabled: active && !!slide && run.status === 'succeeded',
    refetchInterval: (q) =>
      !active
        ? false
        : q.state.data?.some((e) => ['queued', 'running', 'applying'].includes(e.status))
          ? 1500
          : 15000,
  });
}
export type EditThread = ReturnType<typeof useEditThread>;
