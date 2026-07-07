import { defineConfig, devices } from '@playwright/test';
import { loadE2EEnv } from './test/e2eEnv';

export default defineConfig({
  testDir: './test',
  // Exclude the helper modules — they are not spec files.
  testIgnore: ['**/e2eEnv.ts', '**/globalSetup.ts', '**/globalTeardown.ts'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // The devenv Postgres lifecycle lives in these hooks. Skips itself when
  // .env.e2e points at SQLite (no external service needed).
  globalSetup: './test/globalSetup.ts',
  globalTeardown: './test/globalTeardown.ts',
  use: {
    baseURL: 'http://localhost:4080',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // Build frontend assets before starting the server so tests never run
    // against a stale public/dashboard.js or public/style.css.
    command: 'bun scripts/build.ts && PORT=4080 bun index.tsx',
    port: 4080,
    reuseExistingServer: false,
    env: {
      // SQLite in-memory is the fallback when .env.e2e is absent — it matches
      // the pre-existing behavior and keeps `bun test:e2e` working without any
      // external services. Both source and app DBs are pinned here so a
      // Postgres URL in the developer's own .env can't leak into the test run.
      DEV_WAYMARK_TEST_MODE: '1',
      DEV_WAYMARK_SOURCE_DB_ADAPTER: 'sqlite',
      DEV_WAYMARK_SOURCE_DB_URL: 'sqlite:///:memory:',
      DEV_WAYMARK_SOURCE_DB_SEED: 'e2e',
      DEV_WAYMARK_APP_DB_ADAPTER: 'sqlite',
      DEV_WAYMARK_APP_DB_URL: 'sqlite:///:memory:',
      ...loadE2EEnv(),
    },
  },
});
