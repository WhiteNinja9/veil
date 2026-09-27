import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    __BROWSER__: JSON.stringify('chrome'),
    __DEV__: 'false',
    __TEST_MODEL__: 'false',
    __VERSION__: JSON.stringify('test'),
  },
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    environment: 'node',
    coverage: { provider: 'v8', include: ['src/**'], reporter: ['text-summary', 'html'] },
  },
});
