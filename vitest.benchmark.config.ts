import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/__tests__/benchmarks/**/*.test.ts'],
    globals: true,
    testTimeout: 60_000,
    passWithNoTests: true,
  },
});
