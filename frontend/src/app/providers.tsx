// Purpose: Own application-lifetime remote cache and ephemeral UI stores.
// Pattern: Query owns server state; Redux owns UI presentation and scoped unsent chat drafts.
// Usage: App wraps the router once; neither store is persisted to browser storage.
// Related: state/store.ts, app.tsx.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type PropsWithChildren } from 'react';
import { Provider } from 'react-redux';
import { createUiStore } from './state/store';
export function Providers({ children }: PropsWithChildren) {
  const [store] = useState(createUiStore);
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30000, retry: 1, refetchOnWindowFocus: false } },
      }),
  );
  return (
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </Provider>
  );
}
