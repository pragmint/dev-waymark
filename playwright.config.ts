import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './test',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
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
    command: 'PORT=4080 bun index.tsx',
    port: 4080,
    reuseExistingServer: false,
    env: {
      DEV_WAYMARK_APP_DB_URL: 'sqlite:///:memory:',
    },
  },
});
