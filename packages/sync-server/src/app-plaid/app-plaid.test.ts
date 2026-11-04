import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getAccountDb } from '#account-db';
import { SecretName, secretsService } from '#services/secrets-service';

import { handlers as app } from './app-plaid';
import { readItems, writeItems } from './plaid-service';
import type { PlaidItem } from './plaid-service';

const fileId = 'plaid-test-file';
const plaidSecrets = [
  SecretName.plaid_clientId,
  SecretName.plaid_secret,
  SecretName.plaid_environment,
  SecretName.plaid_trialPlan,
  SecretName.plaid_countryCodes,
];

type PlaidCall = { path: string; body: Record<string, unknown> };
type PlaidResponder = (body: Record<string, unknown>) => object;

let calls: PlaidCall[];

// Answers each Plaid path from `responders`; a reply with error_code is sent
// as an HTTP 400, as Plaid does.
function mockPlaid(responders: Record<string, PlaidResponder>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: { body: string }) => {
      const path = new URL(url).pathname;
      const body = JSON.parse(init.body);
      calls.push({ path, body });
      const reply = responders[path](body);
      return new Response(JSON.stringify(reply), {
        status: 'error_code' in reply ? 400 : 200,
      });
    }),
  );
}

function setCredentials(clientId: string, file?: string) {
  secretsService.set(SecretName.plaid_clientId, clientId, file);
  secretsService.set(SecretName.plaid_secret, 'secret', file);
  secretsService.set(SecretName.plaid_environment, 'sandbox', file);
}

// Posts to a route and asserts no access token appears in the response.
async function post(
  path: string,
  body: object = {},
  { token = 'valid-token', file }: { token?: string; file?: string } = {},
) {
  const req = request(app).post(path).set('x-actual-token', token);
  if (file) req.set('X-Actual-File-Id', file);
  const res = await req.send(body);
  expect(JSON.stringify(res.body)).not.toContain('access-sandbox');
  return res;
}

function storedItem(overrides: Partial<PlaidItem> = {}): PlaidItem {
  return {
    ownerUserId: 'genericAdmin',
    clientId: 'global-client',
    environment: 'sandbox',
    accessToken: 'access-sandbox-1',
    institutionId: 'ins_1',
    institutionName: 'First Platypus',
    products: ['transactions'],
    ...overrides,
  };
}

beforeEach(() => {
  calls = [];
  getAccountDb().mutate(
    'INSERT INTO files (id, deleted, owner) VALUES (?, 0, ?)',
    [fileId, 'genericAdmin'],
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  getAccountDb().mutate('DELETE FROM files WHERE id = ?', [fileId]);
  for (const name of plaidSecrets) {
    secretsService.reset(name);
    secretsService.reset(name, fileId);
  }
  writeItems({});
});

describe('Plaid credentials', () => {
  it('reports an unconfigured server', async () => {
    const res = await post('/status');
    expect(res.body.data).toEqual({
      configured: false,
      source: null,
      trialPlan: false,
      countryCodes: ['US'],
    });
  });

  it('prefers per-file credentials and falls back to global', async () => {
    setCredentials('global-client');
    expect((await post('/status', {}, { file: fileId })).body.data.source).toBe(
      'global',
    );

    setCredentials('file-client', fileId);
    secretsService.set(SecretName.plaid_trialPlan, 'true', fileId);
    expect((await post('/status', {}, { file: fileId })).body.data).toEqual({
      configured: true,
      source: 'per-budget-file',
      trialPlan: true,
      countryCodes: ['US'],
    });

    mockPlaid({ '/link/token/create': () => ({ link_token: 'link-1' }) });
    await post('/link-token', {}, { file: fileId });
    await post('/link-token');
    expect(calls.map(call => call.body.client_id)).toEqual([
      'file-client',
      'global-client',
    ]);
  });

  it('rejects files the user cannot access', async () => {
    setCredentials('file-client', fileId);
    const res = await post(
      '/status',
      {},
      { token: 'valid-token-user', file: fileId },
    );
    expect(res.status).toBe(403);
  });
});

describe('Plaid link tokens', () => {
  it('requests a Hosted Link with Investments as an optional product', async () => {
    setCredentials('global-client');
    mockPlaid({
      '/link/token/create': () => ({
        link_token: 'link-1',
        hosted_link_url: 'https://secure.plaid.com/hl/link-1',
      }),
    });

    const res = await post('/link-token');

    expect(res.body.data).toEqual({
      linkToken: 'link-1',
      hostedLinkUrl: 'https://secure.plaid.com/hl/link-1',
    });
    expect(calls[0].body).toMatchObject({
      products: ['transactions'],
      optional_products: ['investments'],
      transactions: { days_requested: 730 },
      hosted_link: {},
      user: { client_user_id: 'genericAdmin' },
    });
    expect(calls[0].body).not.toHaveProperty('redirect_uri');
  });

  it('sends the chosen countries, defaulting to US', async () => {
    setCredentials('global-client');
    mockPlaid({ '/link/token/create': () => ({ link_token: 'link-1' }) });

    await post('/link-token');
    secretsService.set(SecretName.plaid_countryCodes, 'US,CA');
    await post('/link-token');

    expect(calls.map(call => call.body.country_codes)).toEqual([
      ['US'],
      ['US', 'CA'],
    ]);
  });

  it('retries without Investments and remembers the rejection', async () => {
    setCredentials('no-investments-client');
    mockPlaid({
      '/link/token/create': body =>
        body.optional_products
          ? { error_code: 'INVALID_PRODUCT' }
          : { link_token: 'link-1' },
    });

    expect((await post('/link-token')).body.data).toEqual({
      linkToken: 'link-1',
    });
    await post('/link-token');

    expect(calls.map(call => call.body.optional_products)).toEqual([
      ['investments'],
      undefined,
      undefined,
    ]);
  });

  it('opens update mode for an owned Item without products', async () => {
    setCredentials('global-client');
    writeItems({ 'item-1': storedItem() });
    mockPlaid({ '/link/token/create': () => ({ link_token: 'link-2' }) });

    await post('/link-token', { itemId: 'item-1' });

    expect(calls[0].body.access_token).toBe('access-sandbox-1');
    expect(calls[0].body.products).toBeUndefined();
  });

  it('refuses update mode for an Item owned by someone else', async () => {
    setCredentials('global-client');
    writeItems({ 'item-1': storedItem() });
    mockPlaid({});

    const res = await post(
      '/link-token',
      { itemId: 'item-1' },
      { token: 'valid-token-user' },
    );

    expect(res.status).toBe(404);
    expect(calls).toEqual([]);
  });
});

describe('Plaid link results', () => {
  function mockSessions(sessions: object[]) {
    setCredentials('global-client');
    mockPlaid({ '/link/token/get': () => ({ link_sessions: sessions }) });
  }

  it('waits until a session finishes', async () => {
    mockSessions([{ finished_at: null }]);
    const res = await post('/link-result', { linkToken: 'link-1' });
    expect(res.body.data).toEqual({ status: 'pending' });
    expect(calls[0].body).toMatchObject({ link_token: 'link-1' });
  });

  it('reports a session the user left', async () => {
    mockSessions([{ finished_at: '2026-11-06T00:00:00Z', exit: {} }]);
    expect(
      (await post('/link-result', { linkToken: 'link-1' })).body.data,
    ).toEqual({ status: 'exited' });
  });

  it('returns the public token of a finished session', async () => {
    mockSessions([
      {
        finished_at: '2026-11-06T00:00:00Z',
        exit: null,
        results: { item_add_results: [{ public_token: 'public-1' }] },
      },
    ]);
    expect(
      (await post('/link-result', { linkToken: 'link-1' })).body.data,
    ).toEqual({ status: 'success', publicToken: 'public-1' });
  });

  it("reads older teams' on_success and on_exit fields", async () => {
    mockSessions([
      {
        finished_at: '2026-11-06T00:00:00Z',
        on_success: { public_token: 'public-1' },
      },
    ]);
    expect(
      (await post('/link-result', { linkToken: 'link-1' })).body.data,
    ).toEqual({ status: 'success', publicToken: 'public-1' });

    mockSessions([{ finished_at: '2026-11-06T00:00:00Z', on_exit: {} }]);
    expect(
      (await post('/link-result', { linkToken: 'link-1' })).body.data,
    ).toEqual({ status: 'exited' });
  });

  it('finishes update mode without a public token', async () => {
    mockSessions([{ finished_at: '2026-11-06T00:00:00Z', results: {} }]);
    expect(
      (await post('/link-result', { linkToken: 'link-1' })).body.data,
    ).toEqual({ status: 'success' });
  });
});

describe('Plaid Items', () => {
  it('stores an exchanged Item owned by the caller', async () => {
    setCredentials('global-client');
    mockPlaid({
      '/item/public_token/exchange': () => ({
        access_token: 'access-sandbox-new',
        item_id: 'item-new',
      }),
      '/item/get': () => ({
        item: {
          institution_id: 'ins_109508',
          institution_name: 'First Platypus Bank',
          products: ['transactions', 'investments'],
        },
      }),
    });

    const res = await post('/exchange', { publicToken: 'public-1' });

    expect(res.body.data.item).toEqual({
      itemId: 'item-new',
      institutionId: 'ins_109508',
      institutionName: 'First Platypus Bank',
      products: ['transactions', 'investments'],
    });
    expect(readItems()['item-new']).toEqual({
      ownerUserId: 'genericAdmin',
      clientId: 'global-client',
      environment: 'sandbox',
      accessToken: 'access-sandbox-new',
      institutionId: 'ins_109508',
      institutionName: 'First Platypus Bank',
      products: ['transactions', 'investments'],
    });
  });

  it('keeps the exchanged Item when its details cannot be read', async () => {
    setCredentials('global-client');
    mockPlaid({
      '/item/public_token/exchange': () => ({
        access_token: 'access-sandbox-new',
        item_id: 'item-new',
      }),
      '/item/get': () => ({ error_code: 'INTERNAL_SERVER_ERROR' }),
    });

    await post('/exchange', { publicToken: 'public-1' });

    expect(readItems()['item-new'].accessToken).toBe('access-sandbox-new');
  });

  it('lists only Items owned by the caller under the current client_id and environment', async () => {
    setCredentials('global-client');
    writeItems({
      mine: storedItem(),
      others: storedItem({ ownerUserId: 'genericUser' }),
      old: storedItem({ clientId: 'old-client' }),
      production: storedItem({ environment: 'production' }),
    });

    const res = await post('/items');

    expect(
      res.body.data.items.map((item: { itemId: string }) => item.itemId),
    ).toEqual(['mine']);
  });

  it('lists accounts of an owned Item', async () => {
    setCredentials('global-client');
    writeItems({ 'item-1': storedItem() });
    mockPlaid({
      '/accounts/get': () => ({
        accounts: [{ account_id: 'acc-1', name: 'Checking' }],
        item: { item_id: 'item-1' },
      }),
    });

    const res = await post('/accounts', { itemId: 'item-1' });

    expect(res.body.data).toEqual({
      accounts: [{ account_id: 'acc-1', name: 'Checking' }],
    });
  });

  it('removes an owned Item from Plaid and the store', async () => {
    setCredentials('global-client');
    writeItems({ 'item-1': storedItem(), 'item-2': storedItem() });
    mockPlaid({ '/item/remove': () => ({}) });

    await post('/remove-item', { itemId: 'item-1' });

    expect(calls[0]).toMatchObject({
      path: '/item/remove',
      body: { access_token: 'access-sandbox-1' },
    });
    expect(Object.keys(readItems())).toEqual(['item-2']);
  });

  it("reports Plaid errors by code with Plaid's message", async () => {
    setCredentials('global-client');
    writeItems({ 'item-1': storedItem() });
    mockPlaid({
      '/accounts/get': () => ({
        error_code: 'INVALID_FIELD',
        error_message: 'internal detail',
        display_message: 'Investments are not supported by this bank',
      }),
      '/item/remove': () => ({
        error_code: 'INTERNAL_SERVER_ERROR',
        error_message: 'an unexpected error occurred',
        display_message: null,
      }),
    });

    expect((await post('/accounts', { itemId: 'item-1' })).body.data).toEqual({
      error_code: 'INTERNAL_ERROR',
      error_type: 'INVALID_FIELD',
      error_message: 'Investments are not supported by this bank',
    });
    expect(
      (await post('/remove-item', { itemId: 'item-1' })).body.data,
    ).toMatchObject({ error_message: 'an unexpected error occurred' });
  });
});

describe('Plaid transactions', () => {
  function plaidTransaction(overrides: Record<string, unknown> = {}) {
    return {
      transaction_id: 'txn-1',
      account_id: 'acc-1',
      amount: 12.5,
      iso_currency_code: 'USD',
      unofficial_currency_code: null,
      date: '2026-03-01',
      name: 'SQ *COFFEE',
      merchant_name: 'Coffee',
      pending: false,
      pending_transaction_id: null,
      ...overrides,
    };
  }

  function page(overrides: Record<string, unknown> = {}) {
    return {
      added: [],
      modified: [],
      removed: [],
      accounts: [
        {
          account_id: 'acc-1',
          type: 'credit',
          balances: {
            current: 100,
            iso_currency_code: 'USD',
            unofficial_currency_code: null,
          },
        },
      ],
      next_cursor: 'cursor-1',
      has_more: false,
      transactions_update_status: 'HISTORICAL_UPDATE_COMPLETE',
      ...overrides,
    };
  }

  const request = { itemId: 'item-1', accountId: 'acc-1' };

  beforeEach(() => {
    setCredentials('global-client');
    writeItems({ 'item-1': storedItem() });
  });

  it('maps added and modified rows and ignores removed ones', async () => {
    mockPlaid({
      '/transactions/sync': () =>
        page({
          added: [
            plaidTransaction({
              transaction_id: 'pending-1',
              pending: true,
              date: '2026-03-02',
            }),
            plaidTransaction({
              transaction_id: 'posted-1',
              amount: -40,
              merchant_name: null,
              name: 'PAYROLL',
              pending_transaction_id: 'pending-0',
            }),
          ],
          modified: [
            plaidTransaction({
              transaction_id: 'posted-0',
              date: '2026-02-01',
            }),
          ],
          removed: [{ transaction_id: 'pending-0', account_id: 'acc-1' }],
        }),
    });

    const res = await post('/transactions', request);

    expect(calls[0].body).toMatchObject({
      access_token: 'access-sandbox-1',
      options: { account_id: 'acc-1' },
    });
    expect(calls[0].body.cursor).toBeUndefined();
    const { transactions, ...balances } = res.body.data;
    expect(balances).toEqual({
      balances: [
        {
          balanceAmount: { amount: '-100', currency: 'USD' },
          balanceType: 'expected',
        },
      ],
      startingBalance: '-100',
      startingBalanceCurrency: 'USD',
      nextCursor: 'cursor-1',
    });
    // Newest first, with Plaid's outflow-positive sign inverted.
    expect(transactions.all).toEqual([
      {
        transactionId: 'pending-1',
        booked: false,
        date: '2026-03-02',
        payeeName: 'Coffee',
        transactionAmount: { amount: '-12.5', currency: 'USD' },
      },
      {
        transactionId: 'posted-1',
        booked: true,
        date: '2026-03-01',
        payeeName: 'PAYROLL',
        transactionAmount: { amount: '40', currency: 'USD' },
        pendingTransactionId: 'pending-0',
      },
      {
        transactionId: 'posted-0',
        booked: true,
        date: '2026-02-01',
        payeeName: 'Coffee',
        transactionAmount: { amount: '-12.5', currency: 'USD' },
      },
    ]);
    expect(transactions.pending).toEqual([transactions.all[0]]);
    expect(transactions.booked).toEqual(transactions.all.slice(1));
  });

  it('pages to the end from the given cursor', async () => {
    mockPlaid({
      '/transactions/sync': body =>
        body.cursor === 'cursor-1'
          ? page({
              added: [plaidTransaction({ transaction_id: 'txn-2' })],
              next_cursor: 'cursor-2',
            })
          : // A cursor request continues whatever history Plaid holds.
            page({
              added: [plaidTransaction()],
              has_more: true,
              next_cursor: 'cursor-1',
              transactions_update_status: 'INITIAL_UPDATE_COMPLETE',
            }),
    });

    const res = await post('/transactions', {
      ...request,
      cursor: 'cursor-0',
    });

    expect(calls.map(call => call.body.cursor)).toEqual([
      'cursor-0',
      'cursor-1',
    ]);
    expect(
      res.body.data.transactions.all.map(
        (trans: { transactionId: string }) => trans.transactionId,
      ),
    ).toEqual(['txn-1', 'txn-2']);
    expect(res.body.data.nextCursor).toBe('cursor-2');
  });

  it.each(['NOT_READY', 'INITIAL_UPDATE_COMPLETE'])(
    'reports pending history on %s without a cursor',
    async status => {
      mockPlaid({
        '/transactions/sync': () =>
          page({
            added: [plaidTransaction()],
            transactions_update_status: status,
          }),
      });

      const res = await post('/transactions', request);

      expect(res.body.data).toEqual({ historyPending: true });
    },
  );

  it('takes the last 30 days once Plaid has them', async () => {
    mockPlaid({
      '/transactions/sync': () =>
        page({
          added: [plaidTransaction()],
          transactions_update_status: 'INITIAL_UPDATE_COMPLETE',
        }),
    });
    const startDate = new Date(Date.now() - 29 * 86_400_000)
      .toISOString()
      .slice(0, 10);

    const recent = await post('/transactions', { ...request, startDate });
    const older = await post('/transactions', {
      ...request,
      startDate: '2020-01-01',
    });

    expect(recent.body.data.historyPending).toBeUndefined();
    expect(recent.body.data.transactions.all).toHaveLength(1);
    expect(older.body.data).toEqual({ historyPending: true });
  });

  it('reads the balance from /accounts/get for an account missing from the sync', async () => {
    mockPlaid({
      '/transactions/sync': () => page({ accounts: [] }),
      '/accounts/get': () => ({
        accounts: [
          {
            account_id: 'acc-1',
            type: 'loan',
            balances: {
              current: 250,
              iso_currency_code: null,
              unofficial_currency_code: 'BTC',
            },
          },
        ],
      }),
    });

    const res = await post('/transactions', request);

    expect(calls[1]).toEqual({
      path: '/accounts/get',
      body: expect.objectContaining({
        access_token: 'access-sandbox-1',
        options: { account_ids: ['acc-1'] },
      }),
    });
    expect(res.body.data).toMatchObject({
      startingBalance: '-250',
      startingBalanceCurrency: 'BTC',
    });
  });

  it('returns no cursor when a later page fails', async () => {
    mockPlaid({
      '/transactions/sync': body =>
        body.cursor === 'cursor-1'
          ? { error_code: 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' }
          : page({ has_more: true, next_cursor: 'cursor-1' }),
    });

    const res = await post('/transactions', request);

    expect(res.body.data).toMatchObject({ error_code: 'INTERNAL_ERROR' });
    expect(res.body.data.nextCursor).toBeUndefined();
  });

  it.each(['ITEM_LOGIN_REQUIRED', 'PENDING_EXPIRATION'])(
    'asks for a new login on %s',
    async code => {
      mockPlaid({ '/transactions/sync': () => ({ error_code: code }) });

      const res = await post('/transactions', request);

      expect(res.body.data).toEqual({
        error_type: 'ITEM_ERROR',
        error_code: 'ITEM_LOGIN_REQUIRED',
        error_message: code,
      });
    },
  );
});
