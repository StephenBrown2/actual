import * as asyncStorage from '#platform/server/asyncStorage';
import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import { app as exchangeRatesApp } from '#server/exchange-rates/app';
import * as prefs from '#server/prefs';
import { handlers } from '#server/tests/mockSyncServer';
import * as monthUtils from '#shared/months';

import { app } from './app';
import { plaidAccountCurrency } from './plaid';

vi.mock('#server/main', () => ({ getDefaultDocumentDir: vi.fn() }));
vi.mock('#shared/months', async () => ({
  ...(await vi.importActual('#shared/months')),
  currentDay: vi.fn(),
}));

const mockServer: Record<string, () => unknown> = handlers;

describe('plaidAccountCurrency', () => {
  const balances = (
    iso_currency_code: string | null,
    unofficial_currency_code: string | null,
  ) => ({ current: 0, iso_currency_code, unofficial_currency_code });

  it('keeps an ISO code', () => {
    expect(plaidAccountCurrency(balances('EUR', null))).toBe('EUR');
  });

  it('keeps a supported unofficial code', () => {
    expect(plaidAccountCurrency(balances(null, 'JPY'))).toBe('JPY');
  });

  it('reports an unsupported unofficial code as unknown', () => {
    expect(plaidAccountCurrency(balances(null, 'ZZZ'))).toBeNull();
  });

  it('reports no code as unknown', () => {
    expect(plaidAccountCurrency(balances(null, null))).toBeNull();
  });
});

describe('Plaid dialog requests', () => {
  beforeEach(() => {
    vi.mocked(asyncStorage.getItem).mockResolvedValue('test-token');
  });
  afterEach(() => {
    delete mockServer['/plaid/link-token'];
  });

  it("throws Plaid's message so the dialog can show it", async () => {
    mockServer['/plaid/link-token'] = () => ({
      error_code: 'INTERNAL_ERROR',
      error_type: 'INVALID_FIELD',
      error_message: 'Investments are not supported by this bank',
    });
    await expect(app.handlers['plaid-link-token']({})).rejects.toMatchObject({
      type: 'APIError',
      message: 'Investments are not supported by this bank',
    });
  });
});

describe('plaid-accounts-link', () => {
  beforeEach(async () => {
    vi.mocked(monthUtils.currentDay).mockReturnValue('2026-03-10');
    vi.mocked(asyncStorage.getItem).mockResolvedValue('test-token');
    await global.emptyDatabase()();
    await loadMappings();
    await prefs.loadPrefs();
    await db.update('preferences', { id: 'defaultCurrencyCode', value: 'USD' });
    await prefs.savePrefs({
      amountEncoding: JSON.stringify({
        version: 1,
        currencyCode: 'USD',
        precision: 2,
      }),
    });
    for (const flag of ['currency', 'multicurrency']) {
      await db.update('preferences', { id: `flags.${flag}`, value: 'true' });
    }
    mockServer['/plaid/accounts'] = () => ({
      accounts: [
        {
          account_id: 'remote',
          name: 'Checking',
          official_name: null,
          mask: '0000',
          type: 'depository',
          balances: {
            current: 1500,
            iso_currency_code: 'JPY',
            unofficial_currency_code: null,
          },
        },
        {
          account_id: 'card',
          name: 'Card',
          official_name: null,
          mask: '1111',
          type: 'credit',
          balances: {
            current: 500,
            iso_currency_code: 'USD',
            unofficial_currency_code: null,
          },
        },
        {
          account_id: 'no-balance',
          name: 'Savings',
          official_name: null,
          mask: '2222',
          type: 'depository',
          balances: {
            current: null,
            iso_currency_code: 'USD',
            unofficial_currency_code: null,
          },
        },
      ],
    });
  });

  afterEach(() => {
    delete mockServer['/plaid/accounts'];
  });

  it('creates a foreign account for a non-base currency', async () => {
    await exchangeRatesApp.handlers['exchange-rates/save']({
      quoteCurrency: 'JPY',
      rate: '150',
      kind: 'standing',
      date: '2026-01-01',
    });
    const [externalAccount] = await app.handlers['plaid-accounts']({
      itemId: 'item-1',
      institutionId: 'ins_1',
      institutionName: 'Bank',
      products: ['transactions'],
    });

    await expect(
      app.handlers['plaid-accounts-link']({ externalAccount }),
    ).resolves.toMatchObject({ type: 'ok' });

    expect(
      db.firstSync(
        `SELECT a.currency, a.currency_precision, a.account_sync_source, a.mask, b.bank_id
         FROM accounts a JOIN banks b ON a.bank = b.id
         WHERE a.account_id = 'remote' AND a.tombstone = 0`,
      ),
    ).toEqual({
      currency: 'JPY',
      currency_precision: 0,
      account_sync_source: 'plaid',
      mask: '0000',
      bank_id: 'item-1',
    });
    // The current balance becomes the opening balance, at the saved rate.
    expect(
      db.firstSync(
        `SELECT t.amount, t.transaction_amount, t.starting_balance_flag
         FROM transactions t JOIN accounts a ON t.acct = a.id
         WHERE a.account_id = 'remote'`,
      ),
    ).toEqual({
      amount: 1000,
      transaction_amount: 1500,
      starting_balance_flag: 1,
    });
  });

  const item = {
    itemId: 'item-1',
    institutionId: 'ins_1',
    institutionName: 'Bank',
    products: ['transactions'],
  };

  it('opens a credit card with the amount owed as a negative balance', async () => {
    const accounts = await app.handlers['plaid-accounts'](item);
    const card = accounts.find(account => account.account_id === 'card');
    if (!card) throw new Error('card not listed');
    expect(card.balance).toBe(-500);

    await app.handlers['plaid-accounts-link']({ externalAccount: card });

    expect(
      db.firstSync(
        `SELECT t.amount FROM transactions t JOIN accounts a ON t.acct = a.id
         WHERE a.account_id = 'card' AND t.starting_balance_flag = 1`,
      ),
    ).toEqual({ amount: -50000 });
  });

  it('fails the link instead of opening a missing balance at zero', async () => {
    const accounts = await app.handlers['plaid-accounts'](item);
    const savings = accounts.find(
      account => account.account_id === 'no-balance',
    );
    if (!savings) throw new Error('savings not listed');

    await expect(
      app.handlers['plaid-accounts-link']({ externalAccount: savings }),
    ).rejects.toThrow();
    expect(
      db.firstSync(
        `SELECT t.amount FROM transactions t JOIN accounts a ON t.acct = a.id
         WHERE a.account_id = 'no-balance'`,
      ),
    ).toBeNull();
  });
});
