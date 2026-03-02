import type { Page } from '@playwright/test';
import { expect, test as base } from '@playwright/test';

import { saveScreenshot, saveScreenshotComposite } from './helper';
import { ConfigurationPage } from '../page-models/configuration-page';
import { MobileNavigation } from '../page-models/mobile-navigation';
import { Navigation } from '../page-models/navigation';

// Longer wait for budget table when app is under load (e.g. Docker with 7 workers).
const BUDGET_TABLE_TIMEOUT = 45_000;

/** Clear all local data for the current origin so the app starts with a fresh state. */
async function clearLocalData(page: Page): Promise<void> {
  await page.context().clearCookies();
  await page.evaluate(async () => {
    localStorage.clear();
    sessionStorage.clear();
    if (typeof indexedDB !== 'undefined' && indexedDB.databases) {
      const dbs = await indexedDB.databases();
      await Promise.all(
        dbs.map(
          db =>
            new Promise<void>((resolve, reject) => {
              const req = indexedDB.deleteDatabase(db.name);
              req.onsuccess = () => resolve();
              req.onerror = () => reject(req.error);
              req.onblocked = () => resolve();
            }),
        ),
      );
    }
  });
}

const test = base.extend<{ docsPage: Page }>({
  docsPage: [
    async ({ browser }, use) => {
      const page = await browser.newPage();
      await page.goto('/');
      await clearLocalData(page);
      await page.goto('/');
      const configurationPage = new ConfigurationPage(page);
      await configurationPage.createTestFile();
      await page.getByTestId('budget-table').waitFor({ state: 'visible', timeout: BUDGET_TABLE_TIMEOUT });
      await page.evaluate(() => window.Actual.setTheme('auto'));
      await page.setViewportSize(DESKTOP_VIEWPORT);
      await page.waitForTimeout(500);
      await page.mouse.move(0, 0);
      await use(page);
      await page.close();
    },
    // Worker scope: one page per worker, shared by that worker's tests
    // @ts-expect-error - Playwright supports scope: 'worker'; types may be narrow
    { scope: 'worker' },
  ],
});

const DESKTOP_VIEWPORT = { width: 1100, height: 800 };
const MOBILE_VIEWPORT = { width: 350, height: 600 };
// Wide viewport for exactly 3 months (getNumPossibleMonths: estimatedTableWidth 750–1000 → 3; avoid ≥1000 which shows 4)
const WIDE_VIEWPORT = { width: 1320, height: 800 };
const DESKTOP_CLIP = { x: 0, y: 0, ...DESKTOP_VIEWPORT };
const WIDE_CLIP = { x: 0, y: 0, ...WIDE_VIEWPORT };
const MOBILE_CLIP = { x: 0, y: 0, ...MOBILE_VIEWPORT };
// Delay before capture so UI (animations, layout) settles and matches previous manual screenshots.
// To compare: run tests, then diff packages/docs/static/img (e.g. git diff --stat packages/docs/static/img).
const SETTLE_MS = 500;

test.describe('Docs screenshots', () => {
  // 60s timeout; 7 workers when DOC_SCREENSHOTS=1 (1 in CI). Run with E2E_START_URL=http://localhost:3001 and app already running.

  let page: Page;
  let navigation: Navigation;
  let mobileNavigation: MobileNavigation;
  let configurationPage: ConfigurationPage;

  test.beforeEach(async ({ docsPage }) => {
    page = docsPage;
    navigation = new Navigation(page);
    mobileNavigation = new MobileNavigation(page);
    configurationPage = new ConfigurationPage(page);
  });

  test.describe('Tour', () => {
    test.describe('Accounts', () => {
      test('overview (desktop)', async () => {
        await page.getByRole('link', { name: /^Ally Savings/ }).waitFor({ state: 'visible', timeout: 15_000 });
        await navigation.goToAccountPage('Ally Savings');
        await page.getByTestId('transaction-table').waitFor({ state: 'visible', timeout: 10_000 });
        await page.waitForTimeout(SETTLE_MS);
        await saveScreenshot(page, 'a-tour-of-actual', 'tour-account-register-overview', {
          mobile: false,
          clip: DESKTOP_CLIP,
        });
      });

      test('overview (mobile)', async () => {
        await page.setViewportSize(MOBILE_VIEWPORT);
        await page.goto('/accounts/Ally%20Savings');
        await page.waitForTimeout(SETTLE_MS);
        await saveScreenshot(page, 'a-tour-of-actual', 'tour-account-register-overview', {
          mobile: true,
          clip: MOBILE_CLIP,
        });
        await page.setViewportSize(DESKTOP_VIEWPORT);
      });

      test('header (desktop)', async () => {
        await page.setViewportSize(DESKTOP_VIEWPORT);
        await navigation.goToAccountPage('Ally Savings');
        await page.waitForTimeout(SETTLE_MS);
        await saveScreenshot(page, 'a-tour-of-actual', 'tour-account-register-header', {
          mobile: false,
          clip: DESKTOP_CLIP,
        });
      });

      test('adding-transaction (desktop)', async () => {
        await navigation.goToAccountPage('Ally Savings');
        await page.getByRole('button', { name: 'Add New' }).click();
        await page.waitForTimeout(SETTLE_MS);
        await saveScreenshot(page, 'a-tour-of-actual', 'tour-account-register-adding-transaction', {
          mobile: false,
          clip: DESKTOP_CLIP,
        });
        await page.getByRole('button', { name: 'Cancel' }).click();
      });

      test('filter (desktop)', async () => {
        await navigation.goToAccountPage('Ally Savings');
        await page.getByRole('button', { name: 'Filter' }).click();
        // First click opens field-select menu (filters-select-tooltip), not the condition popover (filters-menu-tooltip)
        await page.getByTestId('filters-select-tooltip').waitFor({ state: 'visible', timeout: 10_000 });
        await page.waitForTimeout(SETTLE_MS);
        await saveScreenshot(page, 'a-tour-of-actual', 'tour-account-register-filter', {
          mobile: false,
          clip: DESKTOP_CLIP,
        });
        await page.keyboard.press('Escape');
      });

      test('selected-transactions (desktop)', async () => {
        await navigation.goToAccountPage('Ally Savings');
        await page.getByTestId('transaction-table').getByTestId('row').first().getByTestId('select').click();
        await page.waitForTimeout(SETTLE_MS);
        await saveScreenshot(page, 'a-tour-of-actual', 'tour-account-register-selected-transactions', {
          mobile: false,
          clip: DESKTOP_CLIP,
        });
      });
    });

    test.describe('Budget', () => {
      test('overview (desktop)', async () => {
        await page.setViewportSize(WIDE_VIEWPORT);
        await page.goto('/budget');
        await page.getByTestId('budget-table').waitFor({ state: 'visible', timeout: BUDGET_TABLE_TIMEOUT });
        // Show 3 months (click rightmost calendar in "Choose the number of months" control)
        const monthCountSelector = page.getByTitle('Choose the number of months shown at a time');
        const lastMonthBtn = monthCountSelector.locator('svg').last();
        if (await lastMonthBtn.isVisible()) {
          await lastMonthBtn.click();
          await page.waitForTimeout(SETTLE_MS);
        }
        await saveScreenshot(page, 'a-tour-of-actual', 'tour-budget-overview', {
          mobile: false,
          clip: WIDE_CLIP,
        });
        await page.setViewportSize(DESKTOP_VIEWPORT);
      });

      test('overview (mobile)', async () => {
        await page.setViewportSize(MOBILE_VIEWPORT);
        await page.goto('/budget');
        await page.getByTestId('budget-table').waitFor({ state: 'visible', timeout: BUDGET_TABLE_TIMEOUT });
        await page.waitForTimeout(SETTLE_MS);
        await saveScreenshot(page, 'a-tour-of-actual', 'tour-budget-overview', {
          mobile: true,
          clip: MOBILE_CLIP,
        });
        await page.setViewportSize(DESKTOP_VIEWPORT);
      });

      test('calendar (desktop)', async () => {
        await page.goto('/budget');
        await page.getByTestId('budget-table').waitFor({ state: 'visible', timeout: BUDGET_TABLE_TIMEOUT });
        await page.waitForTimeout(SETTLE_MS);
        // Clip to just the "Choose the number of months" selector (calendar icons) over the budget
        const monthCountSelector = page.getByTitle('Choose the number of months shown at a time');
        const box = await monthCountSelector.boundingBox();
        let clip = DESKTOP_CLIP;
        if (box) {
          const vw = page.viewportSize()?.width ?? 1100;
          const vh = page.viewportSize()?.height ?? 800;
          const pad = 12;
          const x = Math.max(0, Math.floor(box.x - pad));
          const y = Math.max(0, Math.floor(box.y - pad));
          const w = Math.ceil(box.width + pad * 2);
          const h = Math.ceil(box.height + pad * 2);
          clip = {
            x,
            y,
            width: Math.min(vw - x, w),
            height: Math.min(vh - y, h),
          };
        }
        await saveScreenshot(page, 'a-tour-of-actual', 'tour-budget-calendar', {
          mobile: false,
          clip,
        });
      });

      test('calendar-choose (desktop)', async () => {
        await page.setViewportSize(DESKTOP_VIEWPORT);
        await page.goto('/budget');
        await page.getByTestId('budget-table').waitFor({ state: 'visible', timeout: BUDGET_TABLE_TIMEOUT });
        await page.waitForTimeout(SETTLE_MS);
        // Clip to just the month strip (Today, prev, month pills, next)
        const today = page.getByTitle('Today');
        const prevMonth = page.getByTitle('Previous month');
        const nextMonth = page.getByTitle('Next month');
        const boxes = [await today.boundingBox(), await prevMonth.boundingBox(), await nextMonth.boundingBox()].filter(
          (b): b is NonNullable<typeof b> => b != null,
        );
        let clip = DESKTOP_CLIP;
        if (boxes.length > 0) {
          const vw = page.viewportSize()?.width ?? 1100;
          const vh = page.viewportSize()?.height ?? 800;
          const left = Math.min(...boxes.map(b => b.x));
          const top = Math.min(...boxes.map(b => b.y));
          const right = Math.max(...boxes.map(b => b.x + b.width));
          const bottom = Math.max(...boxes.map(b => b.y + b.height));
          const pad = 8;
          clip = {
            x: Math.max(0, Math.floor(left - pad)),
            y: Math.max(0, Math.floor(top - pad)),
            width: Math.min(vw - Math.max(0, left - pad), Math.ceil(right - left + pad * 2)),
            height: Math.min(vh - Math.max(0, top - pad), Math.ceil(bottom - top + pad * 2)),
          };
        }
        await saveScreenshot(page, 'a-tour-of-actual', 'tour-budget-calendar-choose', {
          mobile: false,
          clip,
        });
      });

      test('top-expanded (desktop)', async () => {
        await page.setViewportSize(WIDE_VIEWPORT);
        await page.goto('/budget');
        await page.getByTestId('budget-table').waitFor({ state: 'visible', timeout: BUDGET_TABLE_TIMEOUT });
        // Ensure 3 months only (click rightmost month-count icon)
        const monthCountSelector = page.getByTitle('Choose the number of months shown at a time');
        const lastMonthBtn = monthCountSelector.locator('svg').last();
        if (await lastMonthBtn.isVisible()) {
          await lastMonthBtn.click();
          await page.waitForTimeout(SETTLE_MS);
        }
        // Scope to the budget table so we target the correct row of month cards.
        // BudgetSummaries renders prev + numMonths + next, so 3 displayed months => 5 summary elements (indices 1,2,3 are the visible months).
        const summaryCards = page.getByTestId('budget-table').locator('[data-testid=budget-summary]');
        await summaryCards.first().waitFor({ state: 'visible', timeout: 5000 });
        await expect(summaryCards).toHaveCount(5);
        // Close any open popover so we open the correct card's notes
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
        // Second of the three visible months = index 2 (visible triple is at indices 1, 2, 3)
        const centerCard = summaryCards.nth(2);
        const monthName =
          (await centerCard.evaluate(el => {
            const divs = el.querySelectorAll('div');
            for (const d of divs) {
              const t = d.textContent?.trim();
              if (
                t &&
                /^(January|February|March|April|May|June|July|August|September|October|November|December)$/.test(
                  t,
                )
              )
                return t;
            }
            return 'Month';
          })) ?? 'Month';
        const centerNotesBtn = centerCard.getByRole('button', { name: 'View notes' });
        await centerNotesBtn.click();
        await page.waitForTimeout(300);
        const noteText = `# Markdown syntax is _fully_ supported

This is a note that we have added to the month of ${monthName}.`;
        const notesTextarea = page.locator('textarea:visible');
        await notesTextarea.fill(noteText);
        await page.waitForTimeout(SETTLE_MS);
        // Clip regions: left = first two cards (with note open), right = third card only. Same vertical bounds so heights match when stitched.
        const boxes = await Promise.all([
          summaryCards.nth(1).boundingBox(),
          summaryCards.nth(2).boundingBox(),
          summaryCards.nth(3).boundingBox(),
        ]);
        const validBoxes = boxes.filter((b): b is NonNullable<typeof b> => b != null);
        if (validBoxes.length !== 3) {
          await page.setViewportSize(DESKTOP_VIEWPORT);
          return;
        }
        const [b1, b2, b3] = validBoxes;
        const padX = 16;
        const padY = 8;
        const vw = page.viewportSize()?.width ?? 1320;
        const vh = page.viewportSize()?.height ?? 800;
        const top = Math.min(b1.y, b2.y, b3.y);
        const bottom = Math.max(b1.y + b1.height, b2.y + b2.height, b3.y + b3.height);
        const clipTop = Math.max(0, Math.floor(top - padY));
        const clipBottom = Math.min(vh, Math.ceil(bottom + padY));
        const clipHeight = clipBottom - clipTop;
        // Seam at b3.x: left clip includes card 1, card 2, and the gap between card 2 and 3 so spacing matches the gap between card 1 and 2. Right clip starts at card 3.
        const leftClipX = Math.max(0, Math.floor(b1.x - padX));
        const seamX = b3.x;
        const clipLeftTwo = {
          x: leftClipX,
          y: clipTop,
          width: Math.ceil(seamX - leftClipX),
          height: clipHeight,
        };
        const clipThird = {
          x: Math.floor(seamX),
          y: clipTop,
          width: Math.min(vw - Math.floor(seamX), Math.ceil(b3.width + padX)),
          height: clipHeight,
        };
        // Capture left: first two cards with notes popover open on the center card
        const leftBuffer = await page.screenshot({
          type: 'png',
          clip: clipLeftTwo,
        });
        // Close notes, hover 3rd card so expansion chevron is visible, then capture right
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
        const thirdVisibleCard = summaryCards.nth(3);
        await thirdVisibleCard.hover();
        await page.waitForTimeout(200);
        const collapseBtn = thirdVisibleCard.getByRole('button', {
          name: 'Collapse month summary',
        });
        const collapseBox = await collapseBtn.boundingBox();
        const rightBuffer = await page.screenshot({
          type: 'png',
          clip: clipThird,
        });
        const highlightOnRight =
          collapseBox != null
            ? {
                x: collapseBox.x - clipThird.x,
                y: collapseBox.y - clipThird.y,
                width: collapseBox.width,
                height: collapseBox.height,
              }
            : undefined;
        await saveScreenshotComposite(
          Buffer.from(leftBuffer),
          Buffer.from(rightBuffer),
          'a-tour-of-actual',
          'tour-budget-top-expanded',
          { mobile: false, highlightOnRight },
        );
        await page.setViewportSize(DESKTOP_VIEWPORT);
      });

      test('top-minimized (desktop)', async () => {
        await page.setViewportSize(WIDE_VIEWPORT);
        await page.goto('/budget');
        await page.getByTestId('budget-table').waitFor({ state: 'visible', timeout: BUDGET_TABLE_TIMEOUT });
        // Ensure 3 months
        const monthCountSelector = page.getByTitle('Choose the number of months shown at a time');
        const lastMonthBtn = monthCountSelector.locator('svg').last();
        if (await lastMonthBtn.isVisible()) {
          await lastMonthBtn.click();
          await page.waitForTimeout(SETTLE_MS);
        }
        const summaryCards = page.getByTestId('budget-table').locator('[data-testid=budget-summary]');
        await expect(summaryCards).toHaveCount(5);
        // Minimize all three visible summary cards (indices 1, 2, 3)
        for (let i = 1; i <= 3; i++) {
          const card = summaryCards.nth(i);
          const collapseBtn = card.getByRole('button', { name: 'Collapse month summary' });
          if (await collapseBtn.isVisible()) {
            await collapseBtn.click();
            await page.waitForTimeout(150);
          }
        }
        await page.waitForTimeout(SETTLE_MS);
        const boxes = await Promise.all([
          summaryCards.nth(1).boundingBox(),
          summaryCards.nth(2).boundingBox(),
          summaryCards.nth(3).boundingBox(),
        ]);
        const validBoxes = boxes.filter((b): b is NonNullable<typeof b> => b != null);
        if (validBoxes.length !== 3) {
          await page.setViewportSize(DESKTOP_VIEWPORT);
          return;
        }
        const [b1, b2, b3] = validBoxes;
        const padX = 16;
        const padY = 8;
        const vw = page.viewportSize()?.width ?? 1320;
        const vh = page.viewportSize()?.height ?? 800;
        const top = Math.min(b1.y, b2.y, b3.y);
        const bottom = Math.max(b1.y + b1.height, b2.y + b2.height, b3.y + b3.height);
        const clipTop = Math.max(0, Math.floor(top - padY));
        const clipBottom = Math.min(vh, Math.ceil(bottom + padY));
        const clipLeft = Math.max(0, Math.floor(b1.x - padX));
        const clipRight = Math.min(vw, Math.ceil(b3.x + b3.width + padX));
        const headersClip = {
          x: clipLeft,
          y: clipTop,
          width: clipRight - clipLeft,
          height: clipBottom - clipTop,
        };
        const thirdVisibleCard = summaryCards.nth(3);
        await thirdVisibleCard.hover();
        await page.waitForTimeout(200);
        const expandBtn = thirdVisibleCard.getByRole('button', { name: 'Expand month summary' });
        const highlight = await expandBtn.boundingBox();
        await saveScreenshot(page, 'a-tour-of-actual', 'tour-budget-top-minimized', {
          mobile: false,
          clip: headersClip,
          highlight: highlight ?? undefined,
        });
        await page.setViewportSize(DESKTOP_VIEWPORT);
      });

      test('details (desktop)', async () => {
        await page.setViewportSize(WIDE_VIEWPORT);
        await page.goto('/budget');
        await page.getByTestId('budget-table').waitFor({ state: 'visible', timeout: BUDGET_TABLE_TIMEOUT });
        await page.waitForTimeout(SETTLE_MS);
        const budgetTable = page.getByTestId('budget-table');

        // Ensure 3 months (same as tour-budget-top-expanded) so month column widths match.
        const monthCountSelector = page.getByTitle('Choose the number of months shown at a time');
        const lastMonthBtn = monthCountSelector.locator('svg').last();
        if (await lastMonthBtn.isVisible()) {
          await lastMonthBtn.click();
          await page.waitForTimeout(SETTLE_MS);
        }

        // 1) Collapse month summary cards (one click toggles all).
        const collapseBtn = budgetTable
          .locator('[data-testid=budget-summary]')
          .nth(1)
          .getByRole('button', { name: 'Collapse month summary' });
        if (await collapseBtn.isVisible()) {
          await collapseBtn.click();
          await page.waitForTimeout(200);
        }

        // 2) Add note to Usual Expenses (group is expanded), then collapse the group.
        // Notes button is hover-visible; click via evaluate so we don't wait for visibility.
        const usualExpensesRow = budgetTable
          .locator('[data-testid="row"]')
          .filter({ hasText: 'Usual Expenses' })
          .first();
        await usualExpensesRow.hover();
        await page.waitForTimeout(300);
        await usualExpensesRow.evaluate(row => {
          const btn = [...row.querySelectorAll<HTMLButtonElement>('button[aria-label]')].find(
            b => /view notes/i.test(b.getAttribute('aria-label') ?? ''),
          );
          btn?.click();
        });
        await page.waitForTimeout(200);
        const notesTextarea = page.locator('textarea:visible');
        if (await notesTextarea.isVisible().catch(() => false)) {
          await notesTextarea.fill('Sample');
          await page.keyboard.press('Escape');
          await page.waitForTimeout(200);
        }
        await page.mouse.move(0, 0);
        await page.waitForTimeout(200);
        await usualExpensesRow.locator('svg').first().click({ force: true });
        await page.waitForTimeout(SETTLE_MS);

        // 3) Hover Internet so note icon is visible; then capture.
        await budgetTable.getByText('Internet', { exact: true }).first().hover();
        await page.waitForTimeout(200);

        const tableBox = await budgetTable.boundingBox();
        if (tableBox == null) return;

        // Clip to table: first two month columns only. Use budget-totals row for column widths
        // so month columns match tour-budget-top-expanded (same 3-month layout).
        const totalsRow = budgetTable.getByTestId('budget-totals');
        const { categoryColWidth, monthWidth } = await totalsRow
          .evaluate(el => {
            const firstCol = el.firstElementChild as HTMLElement | null;
            const catW = firstCol ? firstCol.getBoundingClientRect().width : 200;
            const rowW = el.getBoundingClientRect().width;
            const monthW = (rowW - catW) / 3;
            return { categoryColWidth: catW, monthWidth: monthW };
          })
          .catch(() => ({ categoryColWidth: 200, monthWidth: (tableBox.width - 200) / 3 }));
        const detailsClip = {
          x: Math.round(tableBox.x),
          y: Math.round(tableBox.y),
          width: Math.round(categoryColWidth + monthWidth * 2),
          height: Math.round(tableBox.height),
        };

        const pad = 3;
        const withPadding = (b: { x: number; y: number; width: number; height: number }) => ({
          x: b.x - pad,
          y: b.y - pad,
          width: b.width + pad * 2,
          height: b.height + pad * 2,
        });

        // Bounding box for the full category cell (arrows, name, notes) — first column only.
        // Row may have DropHighlight at index 1, so find the wrapper whose first child has category-column width.
        const threeDots = budgetTable.getByTestId('budget-totals').getByRole('button', { name: 'Menu' });
        const groupLabel = budgetTable.getByText('Usual Expenses').first();
        const internetLabel = budgetTable.getByText('Internet', { exact: true }).first();
        const addGroupBtn = page.getByRole('button', { name: 'Add group' });

        const getFullSidebarCellRect = (el: HTMLElement) => {
          const row = el.closest('[data-testid="row"]');
          if (!row) {
            const r = el.getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height };
          }
          for (let i = 0; i < row.children.length; i++) {
            const wrapper = row.children[i] as HTMLElement;
            const first = wrapper?.firstElementChild as HTMLElement | null;
            if (first) {
              const w = first.getBoundingClientRect().width;
              if (w >= 150 && w <= 450) {
                const r = first.getBoundingClientRect();
                return { x: r.x, y: r.y, width: r.width, height: r.height };
              }
            }
          }
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        };

        const [boxThreeDots, boxGroup, boxCategory, boxAddGroup] = await Promise.all([
          threeDots.boundingBox(),
          groupLabel.evaluate(getFullSidebarCellRect).catch(() => groupLabel.boundingBox()),
          internetLabel.evaluate(getFullSidebarCellRect).catch(() => internetLabel.boundingBox()),
          addGroupBtn.boundingBox(),
        ]);

        const highlights = [
          boxThreeDots && { box: withPadding(boxThreeDots), color: '#FDD835' },
          boxGroup && { box: withPadding(boxGroup), color: '#4CAF50' },
          boxCategory && { box: withPadding(boxCategory), color: '#9C27B0' },
          boxAddGroup && { box: withPadding(boxAddGroup), color: '#2196F3' },
        ].filter((h): h is { box: { x: number; y: number; width: number; height: number }; color: string } => h != null);

        await saveScreenshot(page, 'a-tour-of-actual', 'tour-budget-details', {
          mobile: false,
          clip: detailsClip,
          highlights: highlights.length > 0 ? highlights : undefined,
        });
        await page.setViewportSize(DESKTOP_VIEWPORT);
      });
    });

    test.describe('Sidebar', () => {
      test('main (desktop)', async () => {
        await page.goto('/budget');
        await page.getByTestId('budget-table').waitFor({ state: 'visible', timeout: BUDGET_TABLE_TIMEOUT });
        await page.waitForTimeout(SETTLE_MS);
        await saveScreenshot(page, 'using-actual', 'budget-sidebar', {
          mobile: false,
          clip: DESKTOP_CLIP,
        });
      });

      test('main (mobile)', async () => {
        await page.setViewportSize(MOBILE_VIEWPORT);
        await page.goto('/budget');
        await page.getByTestId('budget-table').waitFor({ state: 'visible', timeout: BUDGET_TABLE_TIMEOUT });
        await page.waitForTimeout(SETTLE_MS);
        await saveScreenshot(page, 'using-actual', 'budget-sidebar', {
          mobile: true,
          clip: MOBILE_CLIP,
        });
        await page.setViewportSize(DESKTOP_VIEWPORT);
      });

      test('accounts (desktop)', async () => {
        await page.setViewportSize(DESKTOP_VIEWPORT);
        await page.goto('/budget');
        await page.getByTestId('budget-table').waitFor({ state: 'visible', timeout: BUDGET_TABLE_TIMEOUT });
        await page.waitForTimeout(SETTLE_MS);
        await saveScreenshot(page, 'using-actual', 'budget-sidebar-accounts', {
          mobile: false,
          clip: DESKTOP_CLIP,
        });
      });

      test('accounts (mobile)', async () => {
        await page.setViewportSize(MOBILE_VIEWPORT);
        await page.goto('/accounts');
        await page.waitForTimeout(SETTLE_MS);
        await saveScreenshot(page, 'using-actual', 'budget-sidebar-accounts', {
          mobile: true,
          clip: MOBILE_CLIP,
        });
        await page.setViewportSize(DESKTOP_VIEWPORT);
      });
    });

    test.describe('Settings', () => {
      test('main (desktop)', async () => {
        await navigation.goToSettingsPage();
        await page.getByTestId('settings').waitFor({ state: 'visible', timeout: 15_000 });
        await page.waitForTimeout(SETTLE_MS);
        await saveScreenshot(page, 'using-actual', 'settings', {
          mobile: false,
          clip: DESKTOP_CLIP,
        });
      });
    });

    test.describe('Reports', () => {
      test('overview (desktop)', async () => {
        await navigation.goToReportsPage();
        await page.waitForTimeout(1000);
        await page.waitForTimeout(SETTLE_MS);
        await saveScreenshot(page, 'a-tour-of-actual', 'tour-reports-overview', {
          mobile: false,
          clip: DESKTOP_CLIP,
        });
      });
    });
  });

  test.describe('Getting started', () => {
    test.describe('Tracking budget', () => {
      test('settings (desktop)', async () => {
        await page.setViewportSize(DESKTOP_VIEWPORT);
        await navigation.goToSettingsPage();
        await page.getByTestId('settings').waitFor({ state: 'visible', timeout: 15_000 });
        const switchBtn = page.getByRole('button', { name: 'Switch to tracking budgeting' });
        await switchBtn.scrollIntoViewIfNeeded();
        await page.waitForTimeout(SETTLE_MS);
        const highlight = await switchBtn.boundingBox();
        await saveScreenshot(page, '', 'tracking-budget-settings', {
          mobile: false,
          clip: DESKTOP_CLIP,
          highlight: highlight ?? undefined,
        });
      });

      test('settings (mobile)', async () => {
        await page.setViewportSize(MOBILE_VIEWPORT);
        await page.goto('/settings');
        await page.getByTestId('settings').waitFor({ state: 'visible', timeout: 15_000 });
        const switchBtn = page.getByRole('button', { name: 'Switch to tracking budgeting' });
        await switchBtn.scrollIntoViewIfNeeded();
        await page.waitForTimeout(SETTLE_MS);
        const highlight = await switchBtn.boundingBox();
        await saveScreenshot(page, '', 'tracking-budget-settings', {
          mobile: true,
          clip: MOBILE_CLIP,
          highlight: highlight ?? undefined,
        });
        await page.setViewportSize(DESKTOP_VIEWPORT);
      });
    });
  });
});
