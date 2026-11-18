// Purpose: Connect the tab-local uploader to the application's canonical asset cache.
// Pattern: Shared engine lifetime with one query invalidation callback, no duplicated queue.
// Usage: The Space upload dialog and global notification trigger consume this hook.
// Related: upload-engine.ts, upload-work-panel.tsx, space-directory.tsx.
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getUploadEngine } from './upload-engine';
import { spaceKeys } from './api';
export function useUploadEngine() {
  const client = useQueryClient();
  const [engine] = useState(() =>
    getUploadEngine(() => {
      void client.invalidateQueries({ queryKey: spaceKeys.all });
      void client.invalidateQueries({ queryKey: ['studio'] });
      void client.invalidateQueries({ queryKey: ['library-search'] });
    }),
  );
  return engine;
}
