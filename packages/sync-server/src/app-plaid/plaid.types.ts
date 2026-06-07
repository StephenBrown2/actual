export type PlaidAccount = {
  account_id: string;
  name: string;
  official_name: string | null;
  type: string;
  subtype: string | null;
  balances: {
    current: number | null;
    available: number | null;
    iso_currency_code: string | null;
  };
  mask: string | null;
};

export type PlaidInstitution = {
  institution_id: string;
  name: string;
};

export type PlaidTransaction = {
  transaction_id: string;
  account_id: string;
  date: string;
  authorized_date: string | null;
  amount: number;
  iso_currency_code: string | null;
  name: string;
  merchant_name: string | null;
  pending: boolean;
};

export type PlaidAccessTokenMap = Record<string, string>;
