import * as asyncStorage from '#platform/server/asyncStorage';
import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import { app as exchangeRatesApp } from '#server/exchange-rates/app';
import * as prefs from '#server/prefs';
import { handlers } from '#server/tests/mockSyncServer';
import * as monthUtils from '#shared/months';

import { app } from './app';
import { plaidAccountCurrency } from './plaid';
import { syncAccount } from './sync';

vi.mock('#server/main', () => ({ getDefaultDocumentDir: vi.fn() }));
vi.mock('#shared/months', async () => ({
  ...(await vi.importActual('#shared/months')),
  currentDay: vi.fn(),
}));

const mockServer: Record<string, (body: { accountId: string }) => unknown> =
  handlers;

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
          account_id: 'brokerage',
          name: 'Brokerage',
          official_name: null,
          mask: '4444',
          type: 'investment',
          balances: {
            current: 2000,
            iso_currency_code: 'USD',
            unofficial_currency_code: null,
          },
        },
        {
          account_id: 'eur-brokerage',
          name: 'EUR Brokerage',
          official_name: null,
          mask: '5555',
          type: 'investment',
          balances: {
            current: 300,
            iso_currency_code: 'EUR',
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

    // The link's first sync reports the balance the server derived.
    const balances: Record<string, [string | null, string]> = {
      remote: ['1500', 'JPY'],
      card: ['-500', 'USD'],
      'no-balance': [null, 'USD'],
    };
    mockServer['/plaid/transactions'] = ({
      accountId,
    }: {
      accountId: string;
    }) => ({
      transactions: { all: [], booked: [], pending: [] },
      balances: [],
      startingBalance: balances[accountId][0],
      startingBalanceCurrency: balances[accountId][1],
    });
  });

  afterEach(() => {
    delete mockServer['/plaid/accounts'];
    delete mockServer['/plaid/transactions'];
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

  it('links an investment account to import only its balance', async () => {
    const accounts = await app.handlers['plaid-accounts'](item);
    const brokerage = accounts.find(
      account => account.account_id === 'brokerage',
    );
    if (!brokerage) throw new Error('brokerage not listed');
    expect(brokerage.balanceOnly).toBe(true);
    const transactions = vi.fn();
    mockServer['/plaid/transactions'] = transactions;

    await app.handlers['plaid-accounts-link']({ externalAccount: brokerage });

    const row = db.firstSync<{ id: string }>(
      `SELECT id FROM accounts WHERE account_id = 'brokerage'`,
    );
    if (!row) throw new Error('brokerage not linked');
    const { id } = row;
    expect(
      db.firstSync(`SELECT value FROM preferences WHERE id = ?`, [
        `sync-import-transactions-${id}`,
      ]),
    ).toEqual({ value: 'false' });
    expect(
      db.firstSync(
        `SELECT amount FROM transactions
         WHERE acct = ? AND starting_balance_flag = 1`,
        [id],
      ),
    ).toEqual({ amount: 200000 });
    expect(transactions).not.toHaveBeenCalled();
  });

  it('asks for repair when a balance-only sync needs a new login', async () => {
    const accounts = await app.handlers['plaid-accounts'](item);
    const brokerage = accounts.find(
      account => account.account_id === 'brokerage',
    );
    if (!brokerage) throw new Error('brokerage not listed');
    await app.handlers['plaid-accounts-link']({ externalAccount: brokerage });
    const row = db.firstSync<{ id: string }>(
      `SELECT id FROM accounts WHERE account_id = 'brokerage'`,
    );
    if (!row) throw new Error('brokerage not linked');
    mockServer['/plaid/accounts'] = () => ({
      error_type: 'ITEM_ERROR',
      error_code: 'ITEM_LOGIN_REQUIRED',
    });

    vi.mocked(asyncStorage.multiGet).mockResolvedValue({
      'user-id': 'user',
      'user-key': 'key',
    });

    const { errors } = await app.handlers['accounts-bank-sync']({
      ids: [row.id],
    });

    expect(errors).toEqual([
      expect.objectContaining({
        category: 'ITEM_ERROR',
        code: 'ITEM_LOGIN_REQUIRED',
      }),
    ]);
  });

  it('downloads only the balance when linking a foreign investment account', async () => {
    await exchangeRatesApp.handlers['exchange-rates/save']({
      quoteCurrency: 'EUR',
      rate: '0.5',
      kind: 'standing',
      date: '2026-01-01',
    });
    const accounts = await app.handlers['plaid-accounts'](item);
    const brokerage = accounts.find(
      account => account.account_id === 'eur-brokerage',
    );
    if (!brokerage) throw new Error('brokerage not listed');
    const transactions = vi.fn();
    mockServer['/plaid/transactions'] = transactions;

    await expect(
      app.handlers['plaid-accounts-link']({ externalAccount: brokerage }),
    ).resolves.toMatchObject({ type: 'ok' });

    expect(transactions).not.toHaveBeenCalled();
    expect(
      db.firstSync(
        `SELECT t.transaction_amount FROM transactions t
         JOIN accounts a ON t.acct = a.id
         WHERE a.account_id = 'eur-brokerage' AND t.starting_balance_flag = 1`,
      ),
    ).toEqual({ transaction_amount: 30000 });
  });

  it('imports only rows from the sync start date once transactions are turned on', async () => {
    const accounts = await app.handlers['plaid-accounts'](item);
    const brokerage = accounts.find(
      account => account.account_id === 'brokerage',
    );
    if (!brokerage) throw new Error('brokerage not listed');
    await app.handlers['plaid-accounts-link']({ externalAccount: brokerage });
    const row = db.firstSync<{ id: string }>(
      `SELECT id FROM accounts WHERE account_id = 'brokerage'`,
    );
    if (!row) throw new Error('brokerage not linked');
    await db.update('preferences', {
      id: `sync-import-transactions-${row.id}`,
      value: 'true',
    });
    const trans = (id: string, date: string) => ({
      transactionId: id,
      booked: true,
      date,
      payeeName: 'Dividend',
      transactionAmount: { amount: '5', currency: 'USD' },
    });
    mockServer['/plaid/transactions'] = () => ({
      transactions: {
        all: [trans('new', '2026-03-12'), trans('old', '2026-02-01')],
        booked: [],
        pending: [],
      },
      balances: [],
      startingBalance: '2005',
      startingBalanceCurrency: 'USD',
      nextCursor: 'cursor-1',
    });

    await syncAccount(undefined, undefined, row.id, 'brokerage', 'item-1');

    expect(
      db.runQuery(
        `SELECT imported_id FROM v_transactions
         WHERE account = ? AND starting_balance_flag = 0`,
        [row.id],
        true,
      ),
    ).toEqual([{ imported_id: 'new' }]);
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

describe('Plaid transaction sync', () => {
  type Row = {
    transactionId: string;
    booked: boolean;
    date: string;
    payeeName?: string;
    transactionAmount: { amount: string; currency: string };
    pendingTransactionId?: string;
  };
  let requests: Array<Record<string, unknown>>;
  let response: Record<string, unknown>;
  // Requests answered as pending history before `response` applies.
  let pendingRequests: number;

  function row(
    transactionId: string,
    amount: string,
    overrides: Partial<Row> = {},
  ): Row {
    return {
      transactionId,
      booked: true,
      date: '2026-03-05',
      payeeName: 'Coffee',
      transactionAmount: { amount, currency: 'USD' },
      ...overrides,
    };
  }

  function respond(
    rows: Row[] | Record<string, unknown>,
    { nextCursor = 'cursor-1', currency = 'USD' } = {},
  ) {
    response = Array.isArray(rows)
      ? {
          transactions: { all: rows, booked: [], pending: [] },
          balances: [],
          startingBalance: '100',
          startingBalanceCurrency: currency,
          nextCursor,
        }
      : rows;
  }

  function cursor(id: string) {
    return db.firstSync<Pick<db.DbPreference, 'value'>>(
      'SELECT value FROM preferences WHERE id = ?',
      [`plaid-cursor-${id}`],
    )?.value;
  }

  async function sync(id: string) {
    return syncAccount(undefined, undefined, id, 'checking', 'item-1');
  }

  function rows(id: string) {
    return db.all<
      Pick<
        db.DbViewTransaction,
        | 'imported_id'
        | 'amount'
        | 'transaction_amount'
        | 'cleared'
        | 'starting_balance_flag'
      >
    >(
      `SELECT imported_id, amount, transaction_amount, cleared,
         starting_balance_flag
       FROM v_transactions WHERE account = ? ORDER BY imported_id`,
      [id],
    );
  }

  // Links a checking account whose first download holds one posted and one
  // pending row, and returns its id.
  async function link(currency = 'USD') {
    const amount = (value: string) => ({
      transactionAmount: { amount: value, currency },
    });
    respond(
      [
        row('pending-1', '-20', {
          booked: false,
          date: '2026-03-06',
          ...amount('-20'),
        }),
        row('posted-0', '-10', { date: '2026-03-01', ...amount('-10') }),
      ],
      { currency },
    );
    await app.handlers['plaid-accounts-link']({
      externalAccount: {
        account_id: 'checking',
        name: 'Checking',
        official_name: null,
        mask: '3333',
        balance: 100,
        currency,
        institution: 'Bank',
        itemId: 'item-1',
        balanceOnly: false,
      },
    });
    const account = db.firstSync<Pick<db.DbAccount, 'id'>>(
      `SELECT id FROM accounts WHERE account_id = 'checking'`,
    );
    if (!account) throw new Error('account not linked');
    return account.id;
  }

  beforeEach(async () => {
    vi.mocked(monthUtils.currentDay).mockReturnValue('2026-03-10');
    vi.mocked(asyncStorage.getItem).mockResolvedValue('test-token');
    await global.emptyDatabase()();
    await loadMappings();
    await prefs.loadPrefs();
    requests = [];
    pendingRequests = 0;
    mockServer['/plaid/transactions'] = (body: Record<string, unknown>) => {
      requests.push(body);
      if (pendingRequests > 0) {
        pendingRequests--;
        return { historyPending: true };
      }
      return response;
    };
  });

  afterEach(() => {
    delete mockServer['/plaid/transactions'];
    vi.useRealTimers();
  });

  it('opens with the last 30 days of the first download', async () => {
    const id = await link();

    // The history check, then the link's own download, both from 30 days ago.
    expect(requests).toEqual([
      { itemId: 'item-1', accountId: 'checking', startDate: '2026-02-09' },
      { itemId: 'item-1', accountId: 'checking', startDate: '2026-02-09' },
    ]);
    expect(cursor(id)).toBe('cursor-1');
    expect(await rows(id)).toEqual([
      {
        imported_id: null,
        amount: 13000,
        transaction_amount: null,
        cleared: 1,
        starting_balance_flag: 1,
      },
      {
        imported_id: 'pending-1',
        amount: -2000,
        transaction_amount: null,
        cleared: 0,
        starting_balance_flag: 0,
      },
      {
        imported_id: 'posted-0',
        amount: -1000,
        transaction_amount: null,
        cleared: 1,
        starting_balance_flag: 0,
      },
    ]);
  });

  it('drops older history that Plaid sends after the link', async () => {
    const id = await link();
    respond(
      [
        row('old-1', '-5', { date: '2026-01-20' }),
        row('new-1', '-7', { date: '2026-03-08' }),
      ],
      { nextCursor: 'cursor-2' },
    );

    await sync(id);

    const imported = (await rows(id)).map(trans => trans.imported_id);
    expect(imported).toContain('new-1');
    expect(imported).not.toContain('old-1');
  });

  it('syncs a relinked account from its oldest transaction, past 90 days', async () => {
    const id = await link();
    db.runQuery(
      `UPDATE transactions SET date = 20250601 WHERE starting_balance_flag = 1`,
    );
    await db.update('preferences', { id: `plaid-cursor-${id}`, value: null });
    requests = [];

    await sync(id);

    expect(requests.at(-1)).toMatchObject({ startDate: '2025-06-01' });
  });

  it('waits for full history before the link imports it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    pendingRequests = 2;

    const linked = link();
    await vi.advanceTimersByTimeAsync(10_000);
    const id = await linked;

    expect(requests).toHaveLength(4);
    // The starting balance is the current 100 less both imported rows.
    expect(
      (await rows(id)).map(trans => [trans.imported_id, trans.amount]),
    ).toEqual([
      [null, 13000],
      ['pending-1', -2000],
      ['posted-0', -1000],
    ]);
    expect(cursor(id)).toBe('cursor-1');
  });

  it('fails the link and writes nothing when history never arrives', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    pendingRequests = Infinity;

    const linked = app.handlers['plaid-accounts-link']({
      externalAccount: {
        account_id: 'checking',
        name: 'Checking',
        official_name: null,
        mask: '3333',
        balance: 100,
        currency: 'USD',
        institution: 'Bank',
        itemId: 'item-1',
        balanceOnly: false,
      },
    });
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(await linked).toEqual({ type: 'history-timeout' });
    // One check every 5 s for 10 minutes, plus the first.
    expect(requests).toHaveLength(121);
    expect(db.runQuery('SELECT id FROM accounts', [], true)).toEqual([]);
    expect(db.runQuery('SELECT id FROM transactions', [], true)).toEqual([]);
  });

  it('imports nothing while a sync sees pending history', async () => {
    const id = await link();
    db.runQuery('DELETE FROM transactions');
    db.runQuery(`DELETE FROM preferences WHERE id = 'plaid-cursor-${id}'`);

    pendingRequests = 1;
    await sync(id);
    expect(await rows(id)).toEqual([]);
    expect(cursor(id)).toBeUndefined();

    // The next sync imports the full history with its starting balance.
    await sync(id);
    expect(
      (await rows(id)).map(trans => [trans.imported_id, trans.amount]),
    ).toEqual([
      [null, 13000],
      ['pending-1', -2000],
      ['posted-0', -1000],
    ]);
    expect(cursor(id)).toBe('cursor-1');
  });

  it('clears the cursor when the account is unlinked', async () => {
    const id = await link();

    await app.handlers['account-unlink']({ id });

    expect(cursor(id)).toBeNull();
  });

  it('keeps the cursor when the import fails, so the rows come again', async () => {
    const id = await link();

    // A row without a payee fails the whole import.
    respond(
      [row('posted-1', '-5'), row('posted-2', '-6', { payeeName: undefined })],
      { nextCursor: 'cursor-2' },
    );
    await expect(sync(id)).rejects.toThrow('payeeName');
    expect(cursor(id)).toBe('cursor-1');

    respond([row('posted-1', '-5'), row('posted-2', '-6')], {
      nextCursor: 'cursor-2',
    });
    await sync(id);

    expect(requests[3]).toMatchObject({ cursor: 'cursor-1' });
    expect(cursor(id)).toBe('cursor-2');
    expect((await rows(id)).map(trans => trans.imported_id)).toEqual([
      null,
      'pending-1',
      'posted-0',
      'posted-1',
      'posted-2',
    ]);
  });

  it('merges a posted row into its pending row with the posted amount', async () => {
    const id = await link();

    // The posted amount differs, so only the id can match it.
    respond([row('posted-1', '-25', { pendingTransactionId: 'pending-1' })], {
      nextCursor: 'cursor-2',
    });
    await sync(id);

    expect(requests[2]).toMatchObject({ cursor: 'cursor-1' });
    expect(await rows(id)).toEqual([
      {
        imported_id: null,
        amount: 13000,
        transaction_amount: null,
        cleared: 1,
        starting_balance_flag: 1,
      },
      {
        imported_id: 'posted-0',
        amount: -1000,
        transaction_amount: null,
        cleared: 1,
        starting_balance_flag: 0,
      },
      {
        imported_id: 'posted-1',
        amount: -2500,
        transaction_amount: null,
        cleared: 1,
        starting_balance_flag: 0,
      },
    ]);
  });

  it('leaves a reconciled pending row as it is', async () => {
    const id = await link();
    db.runQuery(
      `UPDATE transactions SET reconciled = 1 WHERE financial_id = 'pending-1'`,
    );

    respond([row('posted-1', '-25', { pendingTransactionId: 'pending-1' })]);
    await sync(id);

    expect(
      (await rows(id)).find(trans => trans.imported_id === 'pending-1'),
    ).toMatchObject({ amount: -2000, cleared: 0 });
  });

  it('gives a foreign posted row its native amount and a new base', async () => {
    await db.update('preferences', { id: 'defaultCurrencyCode', value: 'USD' });
    await prefs.savePrefs({
      amountEncoding: JSON.stringify({
        version: 1,
        currencyCode: 'USD',
        precision: 2,
      }),
    });
    for (const id of ['flags.currency', 'flags.multicurrency']) {
      await db.update('preferences', { id, value: 'true' });
    }
    await exchangeRatesApp.handlers['exchange-rates/save']({
      quoteCurrency: 'EUR',
      rate: '2',
      kind: 'standing',
      date: '2026-01-01',
    });
    const id = await link('EUR');

    respond(
      [
        row('posted-1', '-25', {
          pendingTransactionId: 'pending-1',
          transactionAmount: { amount: '-25', currency: 'EUR' },
        }),
      ],
      { currency: 'EUR' },
    );
    await sync(id);

    const synced = await rows(id);
    expect(synced.map(trans => trans.imported_id)).toEqual([
      null,
      'posted-0',
      'posted-1',
    ]);
    expect(synced[2]).toMatchObject({
      amount: -1250,
      transaction_amount: -2500,
      cleared: 1,
    });
  });

  it('adds a posted row without a pending id as before', async () => {
    const id = await link();

    respond([row('posted-1', '-25')]);
    await sync(id);

    expect(
      (await rows(id)).map(trans => [trans.imported_id, trans.cleared]),
    ).toEqual([
      [null, 1],
      ['pending-1', 0],
      ['posted-0', 1],
      ['posted-1', 1],
    ]);
  });

  it('skips pending rows when pending import is off', async () => {
    const id = await link();
    await db.update('preferences', {
      id: `sync-import-pending-${id}`,
      value: 'false',
    });

    respond([row('pending-2', '-5', { booked: false })]);
    await sync(id);

    expect((await rows(id)).map(trans => trans.imported_id)).toEqual([
      null,
      'pending-1',
      'posted-0',
    ]);
  });

  it('reports a login the bank needs as a bank-sync error', async () => {
    const id = await link();

    respond({ error_type: 'ITEM_ERROR', error_code: 'ITEM_LOGIN_REQUIRED' });

    await expect(sync(id)).rejects.toMatchObject({
      type: 'BankSyncError',
      category: 'ITEM_ERROR',
      code: 'ITEM_LOGIN_REQUIRED',
    });
  });
});
