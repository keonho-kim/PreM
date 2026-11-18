// Purpose: Build and serve the React application with official compiler optimization.
// Pattern: Vite composition with a React Compiler preset before JSX lowering.
// Usage: pnpm dev:frontend or pnpm --filter @prem/frontend build.
// Related: frontend/package.json, vitest.config.ts, dev-docs/08-dependencies.md.
import { fileURLToPath, URL } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import tailwindcss from '@tailwindcss/vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';
import { defineConfig, type Plugin } from 'vite';

function redirectHome(request: IncomingMessage, response: ServerResponse, next: () => void) {
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (url.pathname === '/' || url.pathname === '/home') {
    response.writeHead(307, { Location: `/home/${url.search}` });
    response.end();
    return;
  }
  next();
}

const homeRedirect: Plugin = {
  name: 'prem-home-redirect',
  configureServer(server) {
    server.middlewares.use(redirectHome);
  },
  configurePreviewServer(server) {
    server.middlewares.use(redirectHome);
  },
};

export default defineConfig(({ command }) => ({
  base: '/home/',
  plugins: [
    homeRedirect,
    react(),
    command === 'build' && babel({ presets: [reactCompilerPreset({ target: '19' })] }),
    tailwindcss(),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8000',
      '/healthz': 'http://127.0.0.1:8000',
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
}));
