import { useMemo } from 'react';

import { currencies } from 'loot-core/shared/currencies';
import { q } from 'loot-core/shared/query';

import { useAccounts } from './useAccounts';
import { useFeatureFlag } from './useFeatureFlag';
import { useOnBudgetAccounts } from './useOnBudgetAccounts';
import { useQuery } from './useQuery';
import { useSyncedPref } from './useSyncedPref';

/**
 * Hook to check if multi-currency support is enabled.
 * Requires both the experimental currency feature flag and the user setting to be enabled.
 */
export function useMultiCurrency() {
  const isCurrencyExperimentalEnabled = useFeatureFlag('currency');
  const [enableMultiCurrency] = useSyncedPref('enableMultiCurrency');

  const isMultiCurrencyEnabled =
    isCurrencyExperimentalEnabled && enableMultiCurrency === 'true';

  return {
    isMultiCurrencyEnabled,
    isCurrencyExperimentalEnabled,
    enableMultiCurrency: enableMultiCurrency === 'true',
  };
}

/**
 * Returns the list of available currencies
 */
export function getAvailableCurrencies() {
  return currencies;
}
/**
 * Hook to get currencies from all accounts
 */
export function useAccountCurrencies() {
  const accounts = useAccounts();
  const [defaultCurrencyCode] = useSyncedPref('defaultCurrencyCode');

  const result = useMemo(() => {
    const currencySet = new Set<string>();

    accounts.forEach(account => {
      const currencyCode = account.currency_code || defaultCurrencyCode || '';
      if (currencyCode) {
        currencySet.add(currencyCode);
      }
    });

    return {
      currencies: Array.from(currencySet).sort(),
      isLoading: false,
      error: undefined,
    };
  }, [accounts, defaultCurrencyCode]);

  return result;
}

/**
 * Hook to get currencies from on-budget accounts (non-closed)
 */
export function useOnBudgetCurrencies() {
  const onBudgetAccounts = useOnBudgetAccounts();
  const [defaultCurrencyCode] = useSyncedPref('defaultCurrencyCode');

  const result = useMemo(() => {
    const currencySet = new Set<string>();

    onBudgetAccounts.forEach(account => {
      const currencyCode = account.currency_code || defaultCurrencyCode || '';
      if (currencyCode) {
        currencySet.add(currencyCode);
      }
    });

    return {
      currencies: Array.from(currencySet).sort(),
      isLoading: false,
      error: undefined,
    };
  }, [onBudgetAccounts, defaultCurrencyCode]);

  return result;
}

/**
 * Hook to get currencies used in transactions for a specific month
 */
export function useUsedCurrencies(month: string) {
  const [defaultCurrencyCode] = useSyncedPref('defaultCurrencyCode');

  const query = useMemo(() => {
    if (!month) return null;

    return q('transactions')
      .filter({
        date: { $transform: '$month', $eq: month },
      })
      .select(['account.currency_code'])
      .options({ distinct: true });
  }, [month]);

  const { data, isLoading, error } = useQuery<{
    'account.currency_code': string | null;
  }>(() => query, [query]);

  const result = useMemo(() => {
    if (!data) {
      return {
        currencies: [],
        isLoading,
        error,
      };
    }

    const currencySet = new Set<string>();

    data.forEach(row => {
      const currencyCode =
        row['account.currency_code'] || defaultCurrencyCode || '';
      if (currencyCode) {
        currencySet.add(currencyCode);
      }
    });

    return {
      currencies: Array.from(currencySet).sort(),
      isLoading,
      error,
    };
  }, [data, defaultCurrencyCode, isLoading, error]);

  return result;
}
