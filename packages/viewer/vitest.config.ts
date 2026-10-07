import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    // The dense fixture takes seconds to generate, more while other packages test in parallel.
    hookTimeout: 60_000,
  },
});
