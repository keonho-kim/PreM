// Purpose: Expose provider administration and the safe public authoring-model query.
// Pattern: Feature facade; internal APIs and forms stay private to their consumers.
// Usage: AdminPage mounts the directory.
// Related: provider-directory.tsx, pages/admin-page.tsx.
export { ProviderDirectory } from './provider-directory';

export type { ProviderTab } from './provider-panels';

export { listProviders, getProviderCatalog, providerKeys } from './api';

export { listAuthoringModels, authoringModelsKey } from './authoring-api';
