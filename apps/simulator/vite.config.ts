import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: {
      '@roommix/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
    },
  },
  server: {
    host: true,
    // Same PORT variable the server reads, so `PORT=8081 pnpm dev` keeps both sides in step.
    proxy: { '/ws': { target: `ws://localhost:${process.env.PORT ?? 8080}`, ws: true } },
  },
  worker: { format: 'es' },
  build: { target: 'es2022' },
});
