import type { Page } from '@playwright/test';

import type { Navigation } from './page-models/navigation';

export type CurrencyPrecisionDatum = {
  code: string;
  balance: number;
  expectedDisplay: string;
  /** Debit amount to type in transaction (e.g. '12.34', '1234', '12.345') */
  transactionDebit: string;
  /** Expected debit display in transaction list (e.g. '12.34', '1,234', '12.345') */
  expectedDebitDisplay: string;
  /** Split-transaction test: payee and amounts for each split row */
  split: {
    payee: string;
    debits: string[];
    expectedDisplays: string[];
  };
  /** Modified-amount-persists test: initial value, then change to new value */
  edit: {
    initialDebit: string;
    expectedInitial: string;
    newDebit: string;
    expectedAfter: string;
  };
  /** Account-balance-header-updates test: debit amount and expected display */
  balanceCheck: {
    debit: string;
    expectedDebitDisplay: string;
    expectedHeaderBalance: string;
  };
};

export const currencyPrecisionTestData: CurrencyPrecisionDatum[] = [
  {
    code: '',
    balance: 100,
    expectedDisplay: '100.00',
    transactionDebit: '12.34',
    expectedDebitDisplay: '12.34',
    split: {
      payee: 'Split Default',
      debits: ['33.33', '22.22', '11.11'],
      expectedDisplays: ['33.33', '22.22', '11.11'],
    },
    edit: {
      initialDebit: '99.99',
      expectedInitial: '99.99',
      newDebit: '55.55',
      expectedAfter: '55.55',
    },
    balanceCheck: {
      debit: '12.34',
      expectedDebitDisplay: '12.34',
      expectedHeaderBalance: '7,640.66',
    },
  },
  {
    code: 'JPY',
    balance: 101,
    expectedDisplay: '101',
    transactionDebit: '1234',
    expectedDebitDisplay: '1,234',
    split: {
      payee: 'Split JPY',
      debits: ['1000', '600', '400'],
      expectedDisplays: ['1,000', '600', '400'],
    },
    edit: {
      initialDebit: '5000',
      expectedInitial: '5,000',
      newDebit: '7500',
      expectedAfter: '7,500',
    },
    balanceCheck: {
      debit: '500',
      expectedDebitDisplay: '500',
      expectedHeaderBalance: '‪¥‬764,800',
    },
  },
  {
    code: 'USD',
    balance: 100.5,
    expectedDisplay: '100.50',
    transactionDebit: '12.34',
    expectedDebitDisplay: '12.34',
    split: {
      payee: 'Split USD',
      debits: ['333.33', '222.22', '111.11'],
      expectedDisplays: ['333.33', '222.22', '111.11'],
    },
    edit: {
      initialDebit: '99.99',
      expectedInitial: '99.99',
      newDebit: '55.55',
      expectedAfter: '55.55',
    },
    balanceCheck: {
      debit: '12.34',
      expectedDebitDisplay: '12.34',
      expectedHeaderBalance: '‪$‬7,640.66',
    },
  },
  {
    code: 'KWD',
    balance: 100.5,
    expectedDisplay: '100.500',
    transactionDebit: '12.345',
    expectedDebitDisplay: '12.345',
    split: {
      payee: 'Split KWD',
      debits: ['10.500', '6.250', '4.250'],
      expectedDisplays: ['10.500', '6.250', '4.250'],
    },
    edit: {
      initialDebit: '99.999',
      expectedInitial: '99.999',
      newDebit: '55.555',
      expectedAfter: '55.555',
    },
    balanceCheck: {
      debit: '12.345',
      expectedDebitDisplay: '12.345',
      expectedHeaderBalance: '‪KD‬752.955',
    },
  },
];

/**
 * Set the default currency in Settings. When code is '', ensures Currency
 * support is disabled (Default / no-currency mode). Otherwise enables
 * Currency support and selects the given currency. Returns the label for the
 * currency (e.g. 'Default' or code).
 */
export async function setDefaultCurrency(
  page: Page,
  navigation: Navigation,
  currencyCode: string,
): Promise<string> {
  const settingsPage = await navigation.goToSettingsPage();
  await settingsPage.waitFor();

  if (currencyCode === '') {
    await settingsPage.disableExperimentalFeature('Currency support');
    return 'Default';
  }

  await settingsPage.enableExperimentalFeature('Currency support');

  await settingsPage.selectCurrency(currencyCode);

  return currencyCode;
}
