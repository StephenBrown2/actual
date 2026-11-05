import * as asyncStorage from '#platform/server/asyncStorage';
import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import { app as exchangeRatesApp } from '#server/exchange-rates/app';
import * as prefs from '#server/prefs';
import { handlers } from '#server/tests/mockSyncServer';
import { accountCurrencyFields } from '#server/util/currency';
import { isReviewedCurrency } from '#shared/amount-encoding';
import * as monthUtils from '#shared/months';
import type { SyncServerPlaidAccount } from '#types/models';

import { app } from './app';
import { plaidQuantityDownload, plaidQuantitySecurity } from './plaid';
import river from './plaid-investments.fixture.json';
import { encodeBankAmount, syncAccount } from './sync';

vi.mock('#server/main', () => ({ getDefaultDocumentDir: vi.fn() }));
vi.mock('#shared/months', async () => ({
  ...(await vi.importActual('#shared/months')),
  currentDay: vi.fn(),
}));

const mockServer: Record<string, (body: Record<string, unknown>) => unknown> =
  handlers;

type Fixture = typeof river;

/** The River-derived fixture as a single EUR holding valued in USD. */
function asEur(fixture: Fixture): Fixture {
  const price = 1.2;
  return {
    ...fixture,
    accounts: fixture.accounts.map((account, index) =>
      index === 0
        ? {
            ...account,
            name: 'Individual - EUR',
            balances: { ...account.balances, current: 6000 },
          }
        : account,
    ),
    securities: fixture.securities.map(security => ({
      ...security,
      ticker_symbol: 'EUR',
      type: 'other',
    })),
    holdings: fixture.holdings.map(holding => ({
      ...holding,
      quantity: 5000,
      institution_value: 6000,
    })),
    investment_transactions: fixture.investment_transactions.map(trans => ({
      ...trans,
      quantity: (Math.sign(trans.quantity) * Math.abs(trans.amount)) / price,
    })),
  };
}

// Rows by imported id: native quantity, then the base in USD cents. A sell
// has a negative quantity and amount; interest a positive quantity with a
// negative amount, so both bases follow the quantity's sign.
const cases = [
  {
    currency: 'EUR',
    fixture: asEur(river),
    rows: {
      'inv-buy-A1': [40000, 48000],
      'inv-buy-B2': [32500, 39000],
      'inv-buy-C3': [26000, 31200],
      'inv-buy-F6': [16750, 20100],
      'inv-interest-E5': [1100, 1320],
      'inv-sell-D4': [-8250, -9900],
    },
    // 5000 held less 1081 imported, valued at 6000 USD for 5000.
    start: [391900, 470280],
    held: 500000,
  },
  {
    currency: 'BTC',
    fixture: river,
    rows: {
      'inv-buy-A1': [750000, 48000],
      'inv-buy-B2': [600000, 39000],
      'inv-buy-C3': [480000, 31200],
      'inv-buy-F6': [300000, 20100],
      'inv-interest-E5': [20000, 1320],
      'inv-sell-D4': [-150000, -9900],
    },
    // 0.15 held less 0.02 imported, valued at 9630 USD for 0.15.
    start: [13000000, 834600],
    held: 15000000,
  },
].filter(({ currency }) => isReviewedCurrency(currency));

async function useBudgetCurrency(currencyCode: string) {
  await db.update('preferences', {
    id: 'defaultCurrencyCode',
    value: currencyCode,
  });
  await prefs.savePrefs({
    amountEncoding: JSON.stringify({ version: 1, currencyCode, precision: 2 }),
  });
}

function rateRowCount() {
  return db.firstSync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM exchange_rates',
  )?.count;
}

describe.each(cases)(
  '$currency quantity sync',
  ({ currency, fixture, rows, start, held }) => {
    const [investment] = fixture.accounts;
    const item = {
      itemId: fixture.item.item_id,
      institutionId: fixture.item.institution_id,
      institutionName: 'Example',
      products: ['transactions', 'investments'],
    };
    let holdingsServer = vi.fn();
    let investmentsServer = vi.fn();
    let transactionsServer = vi.fn();

    beforeEach(async () => {
      vi.mocked(monthUtils.currentDay).mockReturnValue('2026-10-20');
      vi.mocked(asyncStorage.getItem).mockResolvedValue('test-token');
      await global.emptyDatabase()();
      await loadMappings();
      await prefs.loadPrefs();
      await useBudgetCurrency('USD');
      for (const flag of ['currency', 'multicurrency']) {
        await db.update('preferences', { id: `flags.${flag}`, value: 'true' });
      }
      mockServer['/plaid/accounts'] = () => ({ accounts: fixture.accounts });
      holdingsServer = vi.fn(() => ({
        holdings: fixture.holdings,
        securities: fixture.securities,
      }));
      investmentsServer = vi.fn(() => ({
        transactions: fixture.investment_transactions,
      }));
      transactionsServer = vi.fn();
      mockServer['/plaid/investments/holdings'] = holdingsServer;
      mockServer['/plaid/investments/transactions'] = investmentsServer;
      mockServer['/plaid/transactions'] = transactionsServer;
    });

    afterEach(() => {
      for (const path of [
        '/plaid/accounts',
        '/plaid/investments/holdings',
        '/plaid/investments/transactions',
        '/plaid/transactions',
      ]) {
        delete mockServer[path];
      }
    });

    async function listInvestment(products = item.products) {
      const accounts = await app.handlers['plaid-accounts']({
        ...item,
        products,
      });
      const listed = accounts.find(
        account => account.account_id === investment.account_id,
      );
      if (!listed) throw new Error('investment account not listed');
      return listed;
    }

    // What the link dialog sends once the offer is accepted.
    function accepted(account: SyncServerPlaidAccount): SyncServerPlaidAccount {
      if (!account.quantityOffer) throw new Error('no quantity offer');
      return {
        ...account,
        currency: account.quantityOffer.currency,
        balance: account.quantityOffer.quantity,
        balanceOnly: false,
        syncQuantity: true,
      };
    }

    function localAccount() {
      return db.firstSync<{
        id: string;
        currency: string | null;
        balance_current: number | null;
      }>(
        `SELECT id, currency, balance_current FROM accounts
       WHERE account_id = ? AND tombstone = 0`,
        [investment.account_id],
      );
    }

    function importedRows() {
      return db.runQuery<{
        imported_id: string | null;
        transaction_amount: number;
        amount: number;
        starting_balance_flag: number;
      }>(
        `SELECT t.financial_id AS imported_id, t.transaction_amount, t.amount,
         t.starting_balance_flag
       FROM transactions t JOIN accounts a ON t.acct = a.id
       WHERE a.account_id = ? AND t.tombstone = 0
       ORDER BY t.starting_balance_flag DESC, t.financial_id`,
        [investment.account_id],
        true,
      );
    }

    function expectedRows(scale = 1) {
      return [
        {
          imported_id: null,
          transaction_amount: start[0],
          amount: start[1] / scale,
          starting_balance_flag: 1,
        },
        ...Object.entries(rows).map(([importedId, [native, base]]) => ({
          imported_id: importedId,
          transaction_amount: native,
          amount: base / scale,
          starting_balance_flag: 0,
        })),
      ];
    }

    it('offers quantity sync for the only security held', async () => {
      expect(await listInvestment()).toMatchObject({
        balanceOnly: true,
        quantityOffer: {
          securityId: fixture.securities[0].security_id,
          currency,
          quantity: fixture.holdings[0].quantity,
        },
      });
    });

    it('imports quantities as native amounts with Plaid values as bases', async () => {
      const rates = rateRowCount();

      await expect(
        app.handlers['plaid-accounts-link']({
          externalAccount: accepted(await listInvestment()),
        }),
      ).resolves.toMatchObject({ type: 'ok' });

      const account = localAccount();
      expect(account?.currency).toBe(currency);
      expect(importedRows()).toEqual(expectedRows());
      expect(
        db.firstSync(`SELECT value FROM preferences WHERE id = ?`, [
          `plaid-quantity-${account?.id}`,
        ]),
      ).toEqual({ value: fixture.securities[0].security_id });
      expect(investmentsServer).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: investment.account_id,
          startDate: '2026-09-21',
          endDate: '2026-10-20',
        }),
      );
      expect(transactionsServer).not.toHaveBeenCalled();
      expect(rateRowCount()).toBe(rates);
    });

    it('keeps the holding quantity as the balance and imports no row twice', async () => {
      await app.handlers['plaid-accounts-link']({
        externalAccount: accepted(await listInvestment()),
      });
      const account = localAccount();
      if (!account) throw new Error('not linked');

      await syncAccount(
        undefined,
        undefined,
        account.id,
        investment.account_id,
        item.itemId,
      );

      expect(localAccount()?.balance_current).toBe(held);
      expect(importedRows()).toEqual(expectedRows());
      expect(investmentsServer).toHaveBeenLastCalledWith(
        expect.objectContaining({ startDate: '2026-09-29' }),
      );
    });

    it('converts bases with the saved rate in another budget currency', async () => {
      await useBudgetCurrency('GBP');
      await exchangeRatesApp.handlers['exchange-rates/save']({
        quoteCurrency: 'USD',
        rate: '2',
        kind: 'standing',
        date: '2026-01-01',
      });
      const rates = rateRowCount();

      await expect(
        app.handlers['plaid-accounts-link']({
          externalAccount: accepted(await listInvestment()),
        }),
      ).resolves.toMatchObject({ type: 'ok' });

      expect(importedRows()).toEqual(expectedRows(2));
      expect(rateRowCount()).toBe(rates);
    });

    it('asks for the missing USD rate and writes nothing', async () => {
      await useBudgetCurrency('GBP');

      await expect(
        app.handlers['plaid-accounts-link']({
          externalAccount: accepted(await listInvestment()),
        }),
      ).resolves.toEqual({
        type: 'rate-unavailable',
        currency: 'USD',
        dates: ['2026-09-29', '2026-10-01', '2026-10-07', '2026-10-08'],
      });
      expect(localAccount()).toBeNull();
      expect(rateRowCount()).toBe(0);
    });

    it('links balance-only when the offer is declined', async () => {
      await app.handlers['plaid-accounts-link']({
        externalAccount: await listInvestment(),
      });

      const account = localAccount();
      expect(account?.currency).toBeNull();
      expect(
        db.firstSync(`SELECT value FROM preferences WHERE id = ?`, [
          `sync-import-transactions-${account?.id}`,
        ]),
      ).toEqual({ value: 'false' });
      expect(investmentsServer).not.toHaveBeenCalled();
    });

    it('imports quantity rows on a relink after a balance-only link', async () => {
      await app.handlers['plaid-accounts-link']({
        externalAccount: await listInvestment(),
      });
      const id = localAccount()?.id;
      if (!id) throw new Error('not linked');
      await app.handlers['account-unlink']({ id });
      // The account now holds the offer's currency, so the offer can link to it.
      await db.update('accounts', {
        id,
        ...(await accountCurrencyFields(currency)),
      });

      await expect(
        app.handlers['plaid-accounts-link']({
          externalAccount: accepted(await listInvestment()),
          upgradingId: id,
        }),
      ).resolves.toMatchObject({ type: 'ok' });

      expect(
        importedRows().flatMap(row =>
          row.imported_id ? [[row.imported_id, row.transaction_amount]] : [],
        ),
      ).toEqual(
        Object.entries(rows).map(([importedId, [native]]) => [
          importedId,
          native,
        ]),
      );
    });

    it('offers nothing when a second currency security is held', async () => {
      holdingsServer.mockReturnValue({
        holdings: [
          ...fixture.holdings,
          { ...fixture.holdings[0], security_id: 'sec-second', quantity: 3 },
        ],
        securities: [
          ...fixture.securities,
          {
            ...fixture.securities[0],
            security_id: 'sec-second',
            ticker_symbol: 'JPY',
          },
        ],
      });

      const listed = await listInvestment();
      expect(listed.quantityOffer).toBeUndefined();
      expect(listed.balanceOnly).toBe(true);
    });

    it('asks for Investments on an Item without it', async () => {
      const listed = await listInvestment(['transactions']);

      expect(listed).toMatchObject({
        needsInvestments: true,
        balanceOnly: true,
      });
      expect(listed.quantityOffer).toBeUndefined();
      expect(holdingsServer).not.toHaveBeenCalled();
    });
  },
);

describe('plaidQuantitySecurity', () => {
  const security = (id: string, ticker: string | null, type: string) => ({
    security_id: id,
    ticker_symbol: ticker,
    unofficial_currency_code: null,
    type,
  });
  const holding = (id: string) => ({
    account_id: 'acct',
    security_id: id,
    quantity: 2,
    institution_value: 3,
    iso_currency_code: 'USD',
  });

  it('ignores cash holdings', () => {
    expect(
      plaidQuantitySecurity('acct', {
        holdings: [holding('cash'), holding('eur')],
        securities: [
          security('cash', 'USD', 'cash'),
          security('eur', 'EUR', 'other'),
        ],
      }),
    ).toEqual({ securityId: 'eur', currency: 'EUR', quantity: 2 });
  });

  it('declines a ticker that is not a currency', () => {
    expect(
      plaidQuantitySecurity('acct', {
        holdings: [holding('aapl')],
        securities: [security('aapl', 'AAPL', 'equity')],
      }),
    ).toBeNull();
  });
});

describe('plaidQuantityDownload', () => {
  const row = (id: string, quantity: number, amount: number) => ({
    investment_transaction_id: id,
    security_id: 'eur',
    date: '2026-10-01',
    name: 'Buy',
    quantity,
    amount,
    iso_currency_code: 'USD',
  });

  it('leaves rounding to the bank amount encoder', () => {
    const download = plaidQuantityDownload(
      { securityId: 'eur', currency: 'EUR' },
      {
        holdings: [
          {
            account_id: 'acct',
            security_id: 'eur',
            quantity: 2.675,
            institution_value: 0.125,
            iso_currency_code: 'USD',
          },
        ],
        securities: [],
      },
      [row('a', 0.125, 2.675), row('b', 4.2e-7, -1e-7)],
    );
    const [rounded, small] = download.transactions;

    // Half-even at 2dp: 2.675 is 268 and 0.125 is 12.
    expect(
      [
        download.startingBalance,
        download.startingBalanceBase?.amount,
        rounded.transactionAmount.amount,
        rounded.baseAmount?.amount,
      ].map(amount => encodeBankAmount(amount ?? '', 2)),
    ).toEqual([268, 12, 12, 268]);
    expect([small.transactionAmount.amount, small.baseAmount?.amount]).toEqual([
      '0.00000042',
      '0.0000001',
    ]);
  });
});
