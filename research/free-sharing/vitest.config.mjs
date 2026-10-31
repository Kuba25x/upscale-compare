import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: {
    include: ['tests/**/*.test.mjs'],
    testTimeout: 60000,
    hookTimeout: 60000,
    fileParallelism: false,
  },
});
