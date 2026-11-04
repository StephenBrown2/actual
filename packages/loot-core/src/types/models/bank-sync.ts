import type {
  GoCardlessAmount,
  GoCardlessBalance,
  GoCardlessTransaction,
} from './gocardless';

export type BankSyncBalance = GoCardlessBalance;
export type BankSyncAmount = GoCardlessAmount;
export type BankSyncTransaction = GoCardlessTransaction & {
  /** On a posted row, the provider id of the pending row it replaces. */
  pendingTransactionId?: string;
  /** The row's date (YYYY-MM-DD), as providers send it beside bookingDate. */
  date?: string;
};

export type BankSyncResponse = {
  transactions: {
    all: BankSyncTransaction[];
    booked: BankSyncTransaction[];
    pending: BankSyncTransaction[];
  };
  balances: BankSyncBalance[];
  // Decimal major units, or null when the provider cannot report a balance.
  startingBalance: string | null;
  /** Currency of startingBalance, or null when unknown or mixed. */
  startingBalanceCurrency?: string | null;
  /** Plaid's `/transactions/sync` cursor after these rows. */
  nextCursor?: string;
  /** Plaid has not finished downloading the history a no-cursor sync asked for. */
  historyPending?: boolean;
  error_type: string;
  error_code: string;
};

export const SYNC_PROVIDERS = [
  'goCardless',
  'simpleFin',
  'pluggyai',
  'enableBanking',
  'akahu',
  'plaid',
] as const;

export type BankSyncProviders = (typeof SYNC_PROVIDERS)[number];
export type BankSyncCredentialSource = 'per-budget-file' | 'global';
export type BankSyncProviderStatus = {
  configured?: boolean;
  source?: BankSyncCredentialSource;
  error?: string;
};
