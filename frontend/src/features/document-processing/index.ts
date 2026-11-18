// Purpose: Expose narrow processing views to Space and Admin.
// Pattern: Feature facade; API details and command state remain private.
// Usage: Pages/features import only these entry points.
// Related: processing-dialog.tsx, settings.tsx, upload-processing.tsx.
export { ProcessingDialog } from './processing-dialog';
export { ProcessingSettings } from './settings';
export type { Job as ProcessingJob } from './api';
export { UploadProcessing, uploadJobOptions } from './upload-processing';
export { processingLabel, stepSummary } from './status';

export { ProcessingView } from './processing-view';

export { getDetail, fileUrl } from './api';

export { getMaterials } from './materials-api';
