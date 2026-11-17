// Purpose: Mount feature tests in real TanStack memory history without production page side effects.
// Pattern: Catch-all test route preserves navigation/search while keeping the tested view mounted.
// Usage: RouterTestHarness wraps a feature under its isolated Query provider.
// Related: app/routing/router.tsx, shared/routing/search.ts.
import { createContext, useContext, useState, type ReactNode } from 'react';
import {
  createRootRoute,
  createRoute,
  createRouter,
  createMemoryHistory,
  RouterProvider,
} from '@tanstack/react-router';
import { UiTestProvider } from './state';
import { parseSearch, stringifySearch, validateSearch } from '@/shared/routing/search';
const Content = createContext<ReactNode>(null);
function TestContent() {
  return useContext(Content);
}
export function RouterTestHarness({
  children,
  initialEntries = ['/'],
  basepath = '/',
}: {
  children: ReactNode;
  initialEntries?: string[];
  basepath?: string;
}) {
  const [router] = useState(() => {
    const root = createRootRoute({ component: TestContent, validateSearch });
    const route = createRoute({ getParentRoute: () => root, path: '$' });
    return createRouter({
      routeTree: root.addChildren([route]),
      history: createMemoryHistory({ initialEntries }),
      basepath,
      parseSearch,
      stringifySearch,
      defaultPendingMinMs: 0,
      defaultHashScrollIntoView: false,
      scrollRestoration: false,
    });
  });
  return (
    <UiTestProvider>
      <Content.Provider value={children}>
        <RouterProvider router={router} />
      </Content.Provider>
    </UiTestProvider>
  );
}
