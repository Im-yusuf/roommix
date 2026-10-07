import { fileURLToPath } from 'node:url';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig } from 'vite';

// `HTTPS=1 pnpm dev` serves a self-signed certificate: phones need a secure
// context for getUserMedia anywhere other than localhost.
export default defineConfig({
  plugins: process.env.HTTPS ? [basicSsl()] : [],
  resolve: {
    alias: {
      '@roommix/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
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
