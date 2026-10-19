import { defineConfig, devices } from '@playwright/test';

const chromium =
  process.env.PLAYWRIGHT_CHROMIUM_PATH ?? (process.env.PLAYWRIGHT_BROWSERS_PATH ? undefined : undefined);

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'retain-on-failure',
    launchOptions: chromium ? { executablePath: chromium } : undefined,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 } } },
  ],
  webServer: {
    command: './scripts/e2e-server.sh',
    url: 'http://localhost:3100/api/health',
    timeout: 240_000,
    reuseExistingServer: false,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
