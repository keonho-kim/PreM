// Purpose: Expose Space route and global work-panel integration without eagerly loading the directory.
// Pattern: Public feature facade with a lazy route component and tab-local notifications.
// Usage: App loads the work panel independently; Space search mounts the directory when browsing.
// Related: space-directory.tsx, upload-work-panel.tsx, app/app.tsx.
import { lazy } from 'react';
export const SpaceDirectory = lazy(() =>
  import('./space-directory').then((module) => ({ default: module.SpaceDirectory })),
);
export { UploadWorkPanel } from './upload-work-panel';

export { useUploadEngine } from './use-upload-engine';
export { LibraryUpload } from './upload-action';
export { UploadDialog } from './upload-dialog';
export { VersionDialog } from './version-dialog';
export {
  listAssets,
  getAsset,
  downloadUrl,
  removeAsset,
  sizeLabel,
  type Asset,
  type LibraryKind,
} from './api';
