import * as asyncStorage from '#platform/server/asyncStorage';
import * as db from '#server/db';
import { APIError, BankSyncError, PostError } from '#server/errors';
import { post } from '#server/post';
import { getPrefs } from '#server/prefs';
import { getServer } from '#server/server-config';
import { isReviewedCurrency } from '#shared/amount-encoding';
import * as monthUtils from '#shared/months';
import type {
  AccountEntity,
  BankSyncResponse,
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
    balanceOnly: account.type === 'investment',
  }));
}

/** A balance-only account's current balance, with no transactions. */
export async function downloadPlaidBalance(acctId: string, itemId: string) {
  const res = await plaidPost<
    { accounts: PlaidAccount[] } & Partial<BankSyncResponse>
  >('/accounts', { itemId });
  // A bank-sync error, unlike the dialogs' message, lets sync offer repair.
  if (res.error_code) {
    throw new BankSyncError(
      res.error_code,
      res.error_type ?? '',
      res.error_code,
    );
  }
  const account = res.accounts.find(
    candidate => candidate.account_id === acctId,
  );
  if (!account) {
    throw new PostError('account-not-found');
  }
  const balance = plaidBalance(account);
  return {
    transactions: [],
    startingBalance: balance === null ? null : String(balance),
    startingBalanceCurrency: plaidAccountCurrency(account.balances),
  };
}

const HISTORY_POLL_MS = 5_000;
const HISTORY_WAIT_MS = 10 * 60_000;

// ponytail: the finished poll downloads the history once more than needed;
// hand that download to the link's sync if Plaid rate limits ever bite.
/**
 * Plaid loads an account's last 30 days before its older history, so a new
 * account starts there unless the user picks an earlier date.
 */
export function plaidDefaultStartDate() {
  return monthUtils.subDays(monthUtils.currentDay(), 29);
}

/**
 * Polls until Plaid holds the account's history from `startDate`, so a link
 * imports all of it. Returns false when the wait runs out. An error ends the
 * wait, and the link's own sync then reports it.
 */
export async function waitForPlaidHistory(
  accountId: string,
  itemId: string,
  startDate: string,
) {
  for (let waited = 0; ; waited += HISTORY_POLL_MS) {
    const res = await plaidPost<Pick<BankSyncResponse, 'historyPending'>>(
      '/transactions',
      { itemId, accountId, startDate },
    );
    if (!res.historyPending) return true;
    if (waited >= HISTORY_WAIT_MS) return false;
    await new Promise(resolve => setTimeout(resolve, HISTORY_POLL_MS));
  }
}

/** The Plaid Item an Actual account syncs from, or null when unlinked. */
export async function plaidAccountItemId({ id }: { id: AccountEntity['id'] }) {
  const row = await db.first<Pick<db.DbBank, 'bank_id'>>(
    `SELECT b.bank_id FROM accounts a JOIN banks b ON a.bank = b.id
     WHERE a.id = ? AND a.account_sync_source = 'plaid'`,
    [id],
  );
  return row?.bank_id ?? null;
}
