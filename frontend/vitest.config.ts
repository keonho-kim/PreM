// Purpose: Run frontend behavior tests in an isolated DOM environment.
// Pattern: Vitest configuration with the production source alias.
// Usage: pnpm --filter @puputyx/frontend test.
// Related: src/pages/home-page.test.tsx, package.json.
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    clearMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/**/*.d.ts'],
      reportsDirectory: '../tests/.artifacts/coverage/frontend',
      reporter: ['text', 'json-summary', 'lcov', 'html'],
    },
  },
});
