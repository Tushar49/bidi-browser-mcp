import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/__tests__/integration/**/*.test.ts'],
    globals: true,
    environment: 'node',
    testTimeout: 30000,
    passWithNoTests: true,
  },
});
