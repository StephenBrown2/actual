import path from 'node:path';

import { defineConfig } from '@playwright/test';

const isDocsScreenshots = process.env.DOC_SCREENSHOTS === '1';

export default defineConfig({
  timeout: 60_000,
  retries: 1,
  fullyParallel: true,
  workers: isDocsScreenshots ? 7 : process.env.CI ? 1 : undefined,
  testDir: 'e2e/',
  testIgnore: isDocsScreenshots ? undefined : ['**/docs-screenshots/**'],
  reporter: process.env.CI
    ? [['blob'], ['list']]
    : [['html', { open: 'never' }]],
  use: {
    userAgent: 'playwright',
    screenshot: 'on',
    browserName: 'chromium',
    baseURL: process.env.E2E_START_URL ?? 'http://localhost:3001',
    trace: 'on-first-retry',
    ignoreHTTPSErrors: true,
  },
  expect: {
    toHaveScreenshot: { maxDiffPixels: 5 },
  },
  // Do not start webServer when E2E_START_URL is set (same as e2e/vrt). Run "yarn start" separately,
  // then: E2E_START_URL=http://localhost:3001 DOC_SCREENSHOTS=1 yarn docs:screenshots
  webServer: process.env.E2E_START_URL
    ? undefined
    : {
        cwd: path.join(__dirname, '..', '..'),
        command: 'yarn start',
        url: 'http://localhost:3001',
        reuseExistingServer: !process.env.CI,
        stdout: 'ignore',
        stderr: 'pipe',
        ignoreHTTPSErrors: true,
      },
});
