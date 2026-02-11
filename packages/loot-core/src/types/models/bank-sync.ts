import type {
  GoCardlessAmount,
  GoCardlessBalance,
  GoCardlessTransaction,
} from './gocardless';

export type BankSyncBalance = GoCardlessBalance;
export type BankSyncAmount = GoCardlessAmount;
export type BankSyncTransaction = GoCardlessTransaction;

export type BankSyncResponse = {
  transactions: {
    all: BankSyncTransaction[];
    booked: BankSyncTransaction[];
    pending: BankSyncTransaction[];
  };
  balances: BankSyncBalance[];
  // Interface with sync-server: amounts are expected to be integers in currency
  // minor units. Today synced accounts effectively assume 2 decimal places.
  // TODO: Use BankSyncAmount in this response so loot-core can correctly handle
  // sync payloads for currencies with non-2-decimal minor units.
  startingBalance: number;
  error_type: string;
  error_code: string;
};

export type BankSyncProviders = 'goCardless' | 'simpleFin' | 'pluggyai';
