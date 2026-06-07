export type SyncServerPlaidAccount = {
  account_id: string;
  name: string;
  official_name: string | null;
  type: string;
  subtype: string | null;
  mask: string | null;
  institution: string | null;
  balance: number | null;
  iso_currency_code?: string | null;
};
