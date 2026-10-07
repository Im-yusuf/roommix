import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Tests import the core from source so nothing has to be built first.
export default defineConfig({
  resolve: {
    alias: {
      '@roommix/core': fileURLToPath(new URL('./core/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: [
      'core/test/**/*.test.ts',
      'server/test/**/*.test.ts',
      'advanced/cli/test/**/*.test.ts',
    ],
    testTimeout: 60_000,
  },
});
