// Purpose: Mount the product router within application-owned providers.
// Pattern: App composition delegates route definitions and shell behavior to routing/.
// Usage: Rendered by main.tsx; shared product access and Admin token policy are feature-owned.
// Related: routing/router.tsx, providers.tsx.
import { RouterProvider } from '@tanstack/react-router';
import { Providers } from './providers';
import { router } from './routing/router';
export function App() {
  return (
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  );
}
