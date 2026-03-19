import './playwright-env';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect as baseExpect } from '@playwright/test';
import type { Locator, TestInfo } from '@playwright/test';

const require = createRequire(import.meta.url);
const { currentTestInfo } = require('playwright/lib/common/globals') as {
  currentTestInfo: () => TestInfo | null;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export { test } from '@playwright/test';

function appendVrtSnapshotManifestLine(
  testInfo: TestInfo,
  absolutePath: string,
) {
  if (!process.env.VRT) return;
  const manifestDir =
    process.env.VRT_SNAPSHOT_MANIFEST_DIR ??
    path.join(__dirname, '.vrt-manifest');
  fs.mkdirSync(manifestDir, { recursive: true });
  const rel = path
    .relative(path.join(__dirname, '..'), absolutePath)
    .split(path.sep)
    .join('/');
  const file = path.join(manifestDir, `parallel-${testInfo.parallelIndex}.txt`);
  fs.appendFileSync(file, `${rel}\n`, 'utf8');
}

export const expect = baseExpect.extend({
  async toMatchThemeScreenshots(locator: Locator) {
    // Disable screenshot assertions in regular e2e tests;
    // only enable them when doing VRT tests
    if (!process.env.VRT) {
      return {
        message: () => 'passed',
        pass: true,
      };
    }

    const testInfo = currentTestInfo();
    if (!testInfo) {
      throw new Error('toMatchThemeScreenshots() must be called during a test');
    }

    const config = {
      mask: [locator.locator('[data-vrt-mask="true"]')],
      maxDiffPixels: 5,
    };

    // Get the data-theme attribute from page.
    // If there is a page() function, it means that the locator
    // is not a page object but a locator object.
    const dataThemeLocator =
      typeof locator.page === 'function'
        ? locator.page().locator('[data-theme]')
        : locator.locator('[data-theme]');

    // Check lightmode
    await locator.evaluate(() => window.Actual.setTheme('auto'));
    await baseExpect(dataThemeLocator).toHaveAttribute('data-theme', 'auto');
    appendVrtSnapshotManifestLine(
      testInfo,
      testInfo.snapshotPath('', { kind: 'screenshot' }),
    );
    await baseExpect(locator).toHaveScreenshot(config);

    // Switch to darkmode and check
    await locator.evaluate(() => window.Actual.setTheme('dark'));
    await baseExpect(dataThemeLocator).toHaveAttribute('data-theme', 'dark');
    appendVrtSnapshotManifestLine(
      testInfo,
      testInfo.snapshotPath('', { kind: 'screenshot' }),
    );
    await baseExpect(locator).toHaveScreenshot(config);

    // Switch to midnight theme and check
    await locator.evaluate(() => window.Actual.setTheme('midnight'));
    await baseExpect(dataThemeLocator).toHaveAttribute(
      'data-theme',
      'midnight',
    );
    appendVrtSnapshotManifestLine(
      testInfo,
      testInfo.snapshotPath('', { kind: 'screenshot' }),
    );
    await baseExpect(locator).toHaveScreenshot(config);

    // Switch back to lightmode
    await locator.evaluate(() => window.Actual.setTheme('auto'));
    return {
      message: () => 'pass',
      pass: true,
    };
  },
});
