import type { BankSyncProviderStatus } from './bank-sync';

export type PlaidStatus = BankSyncProviderStatus & {
  trialPlan?: boolean;
  countryCodes?: string[];
};

/** A Plaid connection as the sync server shares it, without its access token. */
export type PlaidItem = {
  itemId: string;
  institutionId: string | null;
  institutionName: string | null;
  products: string[];
};

/** The fields Actual reads from a Plaid `/accounts/get` account. */
export type PlaidAccount = {
  account_id: string;
  name: string;
  official_name: string | null;
  mask: string | null;
  type: string;
  balances: {
    current: number | null;
    iso_currency_code: string | null;
    unofficial_currency_code: string | null;
  };
};

export type SyncServerPlaidAccount = {
  account_id: string;
  name: string;
  official_name: string | null;
  mask: string | null;
  balance: number;
  /** A supported currency, or null when unknown. */
  currency: string | null;
  institution?: string;
  itemId: string;
  /** Investment accounts import only their balance, for reconciliation. */
  balanceOnly: boolean;
};
