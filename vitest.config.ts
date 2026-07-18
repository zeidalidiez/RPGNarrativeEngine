import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
    },
    include: ['**/*.{test,spec}.{js,mjs,ts,tsx}'],
    passWithNoTests: false,
    restoreMocks: true,
  },
});
