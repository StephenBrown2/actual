import { join } from 'path';

import type { Page } from '@playwright/test';

import {
  currencyPrecisionTestData,
  setDefaultCurrency,
} from './currency-precision';
import { expect, test } from './fixtures';
import type { AccountPage } from './page-models/account-page';
import { ConfigurationPage } from './page-models/configuration-page';
import { Navigation } from './page-models/navigation';

test.describe('Accounts', () => {
  let page: Page;
  let navigation: Navigation;
  let configurationPage: ConfigurationPage;
  let accountPage: AccountPage;

  test.beforeEach(async ({ browser }) => {
    page = await browser.newPage();
    navigation = new Navigation(page);
    configurationPage = new ConfigurationPage(page);

    await page.goto('/');
    await configurationPage.createTestFile();
  });

  test.afterEach(async () => {
    await page?.close();
  });

  test.describe('Currency Precision', () => {
    for (const {
      code,
      balance,
      expectedDisplay,
    } of currencyPrecisionTestData) {
      const codeLabel = code === '' ? 'Default' : code;
      test(`starting balance displayed correctly for ${codeLabel}`, async () => {
        await setDefaultCurrency(page, navigation, code);
        accountPage = await navigation.createAccount({
          name: `${codeLabel} Local Account`,
          offBudget: false,
          balance,
        });
        await accountPage.waitFor();
        await expect(accountPage.accountBalance).toContainText(expectedDisplay);

        const transaction = accountPage.getNthTransaction(0);
        await expect(transaction.payee).toHaveText('Starting Balance');
        await expect(transaction.notes).toHaveText('');
        await expect(transaction.category).toHaveText('Starting Balances');
        await expect(transaction.debit).toHaveText('');
        await expect(transaction.credit).toHaveText(expectedDisplay);
        await expect(page).toMatchThemeScreenshots();
      });

      test(`close account shows correct balance for ${codeLabel}`, async () => {
        await setDefaultCurrency(page, navigation, code);
        accountPage = await navigation.createAccount({
          name: `${codeLabel} Close Test`,
          offBudget: false,
          balance,
        });
        await accountPage.waitFor();
        await expect(accountPage.accountBalance).toContainText(expectedDisplay);

        const modal = await accountPage.clickCloseAccount();
        await expect(modal.locator).toContainText('balance');
        await expect(modal.locator).toContainText(expectedDisplay);
        await expect(modal.locator).toMatchThemeScreenshots();
        await page.reload();
      });
    }
  });

  test('closes an account with transfer', async () => {
    accountPage = await navigation.goToAccountPage('Roth IRA');

    await expect(accountPage.accountName).toHaveText('Roth IRA');

    const modal = await accountPage.clickCloseAccount();
    await modal.selectTransferAccount('Vanguard 401k');
    await expect(page).toMatchThemeScreenshots();
    await modal.closeAccount();

    await expect(accountPage.accountName).toHaveText('Closed: Roth IRA');
    await expect(page).toMatchThemeScreenshots();
  });

  test.describe('On Budget Accounts', () => {
    // Reset filters
    test.afterEach(async () => {
      await accountPage.removeFilter(0);
    });

    test('creates a transfer from two existing transactions', async () => {
      accountPage = await navigation.goToAccountPage('On budget');
      await accountPage.waitFor();

      await expect(accountPage.accountName).toHaveText('On Budget Accounts');

      await accountPage.filterByNote('Test Acc Transfer');

      await accountPage.createSingleTransaction({
        account: 'Ally Savings',
        payee: '',
        notes: 'Test Acc Transfer',
        category: 'Food',
        debit: '34.56',
      });

      await accountPage.createSingleTransaction({
        account: 'HSBC',
        payee: '',
        notes: 'Test Acc Transfer',
        category: 'Food',
        credit: '34.56',
      });

      await page.waitForTimeout(100); // Give time for the previous transaction to be rendered

      await accountPage.selectNthTransaction(0);
      await accountPage.selectNthTransaction(1);
      await accountPage.clickSelectAction('Make transfer');

      let transaction = accountPage.getNthTransaction(0);
      await expect(transaction.payee).toHaveText('Ally Savings');
      await expect(transaction.category).toHaveText('Transfer');
      await expect(transaction.credit).toHaveText('34.56');
      await expect(transaction.account).toHaveText('HSBC');

      transaction = accountPage.getNthTransaction(1);
      await expect(transaction.payee).toHaveText('HSBC');
      await expect(transaction.category).toHaveText('Transfer');
      await expect(transaction.debit).toHaveText('34.56');
      await expect(transaction.account).toHaveText('Ally Savings');
    });
  });

  test.describe('Import Transactions', () => {
    test.beforeEach(async () => {
      accountPage = await navigation.createAccount({
        name: 'CSV import',
        offBudget: false,
        balance: 0,
      });
      await accountPage.waitFor();
    });

    async function importCsv(screenshot = false) {
      const fileChooserPromise = page.waitForEvent('filechooser');
      await accountPage.page.getByRole('button', { name: 'Import' }).click();

      const fileChooser = await fileChooserPromise;
      await fileChooser.setFiles(join(__dirname, 'data/test.csv'));

      const importButton = accountPage.page.getByRole('button', {
        name: /Import \d+ transactions/,
      });

      await importButton.waitFor({ state: 'visible' });

      if (screenshot) await expect(page).toMatchThemeScreenshots();

      await importButton.click();

      await expect(importButton).not.toBeVisible();
    }

    test('imports transactions from a CSV file', async () => {
      await importCsv(true);
    });

    test('import csv file twice', async () => {
      await importCsv(false);

      const fileChooserPromise = page.waitForEvent('filechooser');
      await accountPage.page.getByRole('button', { name: 'Import' }).click();

      const fileChooser = await fileChooserPromise;
      await fileChooser.setFiles(join(__dirname, 'data/test.csv'));

      const importButton = accountPage.page.getByRole('button', {
        name: /Import \d+ transactions/,
      });

      await importButton.waitFor({ state: 'visible' });

      await expect(page).toMatchThemeScreenshots();

      await expect(importButton).toBeDisabled();
      expect(await importButton.innerText()).toMatch(/Import 0 transactions/);

      await accountPage.page.getByRole('button', { name: 'Close' }).click();

      await expect(importButton).not.toBeVisible();
    });

    test('import notes checkbox is not shown for CSV files', async () => {
      const fileChooserPromise = page.waitForEvent('filechooser');
      await accountPage.page.getByRole('button', { name: 'Import' }).click();

      const fileChooser = await fileChooserPromise;
      await fileChooser.setFiles(join(__dirname, 'data/test.csv'));

      // Verify the import notes checkbox is not visible for CSV files
      const importNotesCheckbox = page.getByRole('checkbox', {
        name: 'Import notes from file',
      });
      await expect(importNotesCheckbox).not.toBeVisible();

      // Import the transactions
      const importButton = page.getByRole('button', {
        name: /Import \d+ transactions/,
      });
      await importButton.click();

      // Verify the transactions were imported
      await expect(importButton).not.toBeVisible();
    });
  });
});
