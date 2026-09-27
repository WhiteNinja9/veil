import { defineConfig } from '@playwright/test';

/**
 * Browser tests load the unpacked extension into Chromium (new headless
 * mode supports extensions). The `test-model` build swaps real models for
 * the deterministic provider so verdicts are exact and no explicit media
 * is needed. Firefox cannot load unpacked MV3 extensions through
 * Playwright; see docs/TESTING.md for the web-ext based Firefox procedure.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium-test-model', testIgnore: /real-model/ },
    { name: 'chromium-real-model', testMatch: /real-model/ },
  ],
});
