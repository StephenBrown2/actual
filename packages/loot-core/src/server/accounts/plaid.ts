import * as asyncStorage from '#platform/server/asyncStorage';
import { APIError, PostError } from '#server/errors';
import { post } from '#server/post';
import { getPrefs } from '#server/prefs';
import { getServer } from '#server/server-config';
import { isReviewedCurrency } from '#shared/amount-encoding';
import type {
  PlaidAccount,
  PlaidItem,
  SyncServerPlaidAccount,
} from '#types/models';

/** Posts to the sync server's Plaid routes with this budget file's credentials. */
export async function plaidPost<T>(
  path: string,
  body: Record<string, unknown> = {},
): Promise<T> {
  const userToken = await asyncStorage.getItem('user-token');
  if (!userToken) {
    throw new PostError('unauthorized');
  }
  const serverConfig = getServer();
  if (!serverConfig) {
    throw new Error('Failed to get server config.');
  }
  const fileId = getPrefs()?.cloudFileId;
  return post(
    serverConfig.PLAID_SERVER + path,
    body,
    {
      'X-ACTUAL-TOKEN': userToken,
      ...(fileId ? { 'X-Actual-File-Id': fileId } : {}),
    },
    60000,
  );
}

/** The account's currency when Actual supports it, otherwise unknown. */
export function plaidAccountCurrency({
  iso_currency_code,
  unofficial_currency_code,
}: PlaidAccount['balances']): string | null {
  const code = iso_currency_code ?? unofficial_currency_code;
  return code && isReviewedCurrency(code) ? code : null;
}

// Plaid reports credit and loan balances as the positive amount owed.
function plaidBalance({ type, balances }: PlaidAccount): number | null {
  if (balances.current == null) {
    return null;
  }
  return type === 'credit' || type === 'loan'
    ? -balances.current
    : balances.current;
}

/**
 * Like `plaidPost`, but a failed Plaid request throws Plaid's own message, so
 * the dialog that asked can show it.
 */
export async function plaidLinkPost<T>(
  path: string,
  body: Record<string, unknown> = {},
): Promise<T> {
  const res = await plaidPost<
    T & { error_code?: string; error_message?: string }
  >(path, body);
  if (res.error_code) {
    throw APIError(res.error_message ?? res.error_code);
  }
  return res;
}

async function fetchPlaidAccounts(itemId: string) {
  const { accounts } = await plaidLinkPost<{ accounts: PlaidAccount[] }>(
    '/accounts',
    { itemId },
  );
  return accounts;
}

export async function getPlaidAccounts(
  item: PlaidItem,
): Promise<SyncServerPlaidAccount[]> {
  return (await fetchPlaidAccounts(item.itemId)).map(account => ({
    account_id: account.account_id,
    name: account.name,
    official_name: account.official_name,
    mask: account.mask,
    balance: plaidBalance(account) ?? 0,
    currency: plaidAccountCurrency(account.balances),
    institution: item.institutionName ?? undefined,
    itemId: item.itemId,
  }));
}

// ponytail: balance only, so a link records the current balance as the
// opening balance. Transaction download replaces this with /transactions.
export async function downloadPlaidBalance(acctId: string, itemId: string) {
  const account = (await fetchPlaidAccounts(itemId)).find(
    candidate => candidate.account_id === acctId,
  );
  if (!account) {
    throw new PostError('account-not-found');
  }
  const balance = plaidBalance(account);
  return {
    transactions: [],
    // A missing balance is left to the shared balance-unavailable handling.
    startingBalance: balance === null ? null : String(balance),
    startingBalanceCurrency: plaidAccountCurrency(account.balances),
  };
}
