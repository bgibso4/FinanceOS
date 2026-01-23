import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'list',
  // Timeout for each test
  timeout: 30 * 1000,
  // Timeout for expect() assertions
  expect: {
    timeout: 10 * 1000,
  },
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Headless by default for agent-driven workflows
    headless: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Automatically start the dev server before running E2E tests
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    // In CI, always start fresh; locally, reuse if already running
    reuseExistingServer: !process.env.CI,
    // Give Next.js time to compile and start
    timeout: 180 * 1000,
    // Show server output for debugging
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
