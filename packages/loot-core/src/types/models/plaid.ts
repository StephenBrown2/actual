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
  /** The account's only security, when it is a currency Actual supports. */
  quantityOffer?: PlaidQuantitySecurity & { quantity: number };
  /** An investment account on an Item without the Investments product. */
  needsInvestments?: boolean;
  /** Set by the link dialog when the user accepts the quantity offer. */
  syncQuantity?: boolean;
};

/** A quantity-synced account's security and the currency it is held as. */
export type PlaidQuantitySecurity = { securityId: string; currency: string };

/** The fields Actual reads from `/investments/holdings/get`. */
export type PlaidHoldings = {
  holdings: Array<{
    account_id: string;
    security_id: string;
    quantity: number;
    institution_value: number;
    iso_currency_code: string | null;
  }>;
  securities: Array<{
    security_id: string;
    ticker_symbol: string | null;
    unofficial_currency_code: string | null;
    type: string | null;
  }>;
};

/** The fields Actual reads from an `/investments/transactions/get` row. */
export type PlaidInvestmentTransaction = {
  investment_transaction_id: string;
  security_id: string | null;
  date: string;
  name: string;
  quantity: number;
  amount: number;
  iso_currency_code: string | null;
};
