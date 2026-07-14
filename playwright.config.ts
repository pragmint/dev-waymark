import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './test',
  // Exclude the helper modules — they are not spec files.
  testIgnore: ['**/e2eEnv.ts', '**/globalSetup.ts', '**/globalTeardown.ts'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Frontend build runs once here; per-worker webServers are spawned by the
  // fixture in test/strictTest.ts so parallel workers don't share app state.
  // The devenv Postgres lifecycle also lives in these hooks.
  globalSetup: './test/globalSetup.ts',
  globalTeardown: './test/globalTeardown.ts',
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
