import express from 'express';
import type { Request, Response } from 'express';

import { handleError } from '#app-gocardless/util/handle-error';
import * as UserService from '#services/user-service';
import {
  requestLoggerMiddleware,
  validateSessionMiddleware,
} from '#util/middlewares';
import { isValidFileId } from '#util/paths';

import {
  createLinkToken,
  getCredentials,
  getOwnedItem,
  isUsableItem,
  PlaidError,
  plaidRequest,
  readItems,
  writeItems,
} from './plaid-service';
import type {
  LinkTokenResponse,
  PlaidCredentials,
  PlaidItem,
} from './plaid-service';

// Errors fixed by logging in again through update-mode Link.
const REPAIR_CODES = ['ITEM_LOGIN_REQUIRED', 'PENDING_EXPIRATION'];

// Plaid's own message rides along with its code, so dialogs can explain a
// failure. `error_type` keeps the code, which bank sync reads as the category;
// errors a new login fixes become the bank-sync repair error.
function handlePlaidError(
  func: (req: Request, res: Response) => Promise<unknown>,
) {
  return handleError(async (req, res) => {
    try {
      await func(req, res);
    } catch (error) {
      if (!(error instanceof PlaidError)) throw error;
      console.log('Error', req.method, req.baseUrl + req.path, error.code);
      const repair = REPAIR_CODES.includes(error.code);
      res.send({
        status: 'ok',
        data: {
          error_code: repair ? 'ITEM_LOGIN_REQUIRED' : 'INTERNAL_ERROR',
          error_type: repair ? 'ITEM_ERROR' : error.code,
          error_message: error.displayMessage ?? error.code,
        },
      });
    }
  });
}

const app = express();
export { app as handlers };
app.use(requestLoggerMiddleware);
app.use(express.json());
app.use(validateSessionMiddleware);

// Every route may read per-budget-file credentials, so check file access first.
app.use((req, res, next) => {
  const fileId = req.get('X-Actual-File-Id');
  if (fileId && !isValidFileId(fileId)) {
    res.status(400).send({
      status: 'error',
      reason: 'invalid-file-id',
      details: 'invalid fileId',
    });
    return;
  }
  if (fileId && !UserService.canAccessActiveFile(fileId, res.locals.user_id)) {
    res.status(403).send({
      status: 'error',
      reason: 'file-access-denied',
      details: "You don't have permissions over this file",
    });
    return;
  }
  next();
});

function requireCredentials(req: Request, res: Response) {
  const credentials = getCredentials(req.get('X-Actual-File-Id'));
  if (!credentials) {
    res.status(400).send({
      status: 'error',
      reason: 'not-configured',
      details: 'Plaid credentials are not configured',
    });
  }
  return credentials;
}

function requireItem(
  req: Request,
  res: Response,
  credentials: PlaidCredentials,
) {
  const item = getOwnedItem(req.body?.itemId, res.locals.user_id, credentials);
  if (!item) {
    res.status(404).send({
      status: 'error',
      reason: 'item-not-found',
      details: 'Plaid connection not found',
    });
  }
  return item;
}

// The client-facing view of an Item. Access tokens never leave the server.
function publicItem(itemId: string, item: PlaidItem) {
  return {
    itemId,
    institutionId: item.institutionId,
    institutionName: item.institutionName,
    products: item.products,
  };
}

app.post(
  '/status',
  handlePlaidError(async (req, res) => {
    const credentials = getCredentials(req.get('X-Actual-File-Id'));
    res.send({
      status: 'ok',
      data: {
        configured: !!credentials,
        source: credentials?.source ?? null,
        trialPlan: credentials?.trialPlan ?? false,
        countryCodes: credentials?.countryCodes ?? ['US'],
      },
    });
  }),
);

app.post(
  '/link-token',
  handlePlaidError(async (req, res) => {
    const credentials = requireCredentials(req, res);
    if (!credentials) return;

    const { itemId } = req.body ?? {};
    // Hosted Link runs on Plaid's site, which Actual's cross-origin isolation
    // would block from loading in the app. Plaid also handles OAuth there.
    const base = {
      client_name: 'Actual Budget',
      language: 'en',
      country_codes: credentials.countryCodes,
      user: { client_user_id: res.locals.user_id },
      hosted_link: {},
    };

    let link: LinkTokenResponse;
    if (itemId === undefined) {
      link = await createLinkToken(credentials, base);
    } else {
      // Update mode repairs or extends an existing Item and takes no products.
      const item = requireItem(req, res, credentials);
      if (!item) return;
      link = await plaidRequest<LinkTokenResponse>(
        credentials,
        '/link/token/create',
        { ...base, access_token: item.accessToken },
      );
    }

    res.send({
      status: 'ok',
      data: { linkToken: link.link_token, hostedLinkUrl: link.hosted_link_url },
    });
  }),
);

// Reports a Hosted Link session's outcome. Plaid keeps it for six hours after
// the session ends, so polling works without webhooks.
app.post(
  '/link-result',
  handlePlaidError(async (req, res) => {
    const credentials = requireCredentials(req, res);
    if (!credentials) return;

    const linkToken = req.body?.linkToken;
    if (typeof linkToken !== 'string') {
      res.status(400).send({
        status: 'error',
        reason: 'invalid-request',
        details: 'linkToken is required',
      });
      return;
    }

    const { link_sessions: sessions = [] } = await plaidRequest<{
      link_sessions?: Array<{
        finished_at?: string | null;
        exit?: object | null;
        results?: {
          item_add_results?: Array<{ public_token: string }>;
        };
        // Older Plaid teams receive these instead of `exit` and `results`.
        on_exit?: object | null;
        on_success?: { public_token?: string } | null;
      }>;
    }>(credentials, '/link/token/get', { link_token: linkToken });

    const session = sessions.find(candidate => candidate.finished_at);
    let data: {
      status: 'pending' | 'exited' | 'success';
      publicToken?: string;
    };
    if (!session) {
      data = { status: 'pending' };
    } else if (session.exit || session.on_exit) {
      data = { status: 'exited' };
    } else {
      // Update mode keeps the Item's access token, so it adds no Item.
      const publicToken =
        session.results?.item_add_results?.[0]?.public_token ??
        session.on_success?.public_token;
      data = { status: 'success', ...(publicToken ? { publicToken } : {}) };
    }
    res.send({ status: 'ok', data });
  }),
);

app.post(
  '/exchange',
  handlePlaidError(async (req, res) => {
    const credentials = requireCredentials(req, res);
    if (!credentials) return;

    const publicToken = req.body?.publicToken;
    if (typeof publicToken !== 'string') {
      res.status(400).send({
        status: 'error',
        reason: 'invalid-request',
        details: 'publicToken is required',
      });
      return;
    }

    const { access_token: accessToken, item_id: itemId } = await plaidRequest<{
      access_token: string;
      item_id: string;
    }>(credentials, '/item/public_token/exchange', {
      public_token: publicToken,
    });

    // Institution details are display metadata. Losing them must not lose the
    // Item, which on the Trial plan uses a lifetime slot.
    const details = await plaidRequest<{
      item: {
        institution_id?: string | null;
        institution_name?: string | null;
        products?: string[];
      };
    }>(credentials, '/item/get', { access_token: accessToken }).catch(
      () => null,
    );

    const item: PlaidItem = {
      ownerUserId: res.locals.user_id,
      clientId: credentials.clientId,
      environment: credentials.environment,
      accessToken,
      institutionId: details?.item.institution_id ?? null,
      institutionName: details?.item.institution_name ?? null,
      products: details?.item.products ?? [],
    };
    writeItems({ ...readItems(), [itemId]: item });

    res.send({ status: 'ok', data: { item: publicItem(itemId, item) } });
  }),
);

app.post(
  '/items',
  handlePlaidError(async (req, res) => {
    const credentials = requireCredentials(req, res);
    if (!credentials) return;

    const items = Object.entries(readItems())
      .filter(([, item]) => isUsableItem(item, res.locals.user_id, credentials))
      .map(([itemId, item]) => publicItem(itemId, item));

    res.send({ status: 'ok', data: { items } });
  }),
);

app.post(
  '/accounts',
  handlePlaidError(async (req, res) => {
    const credentials = requireCredentials(req, res);
    if (!credentials) return;
    const item = requireItem(req, res, credentials);
    if (!item) return;

    const { accounts } = await plaidRequest<{ accounts: unknown[] }>(
      credentials,
      '/accounts/get',
      { access_token: item.accessToken },
    );

    res.send({ status: 'ok', data: { accounts } });
  }),
);

app.post(
  '/remove-item',
  handlePlaidError(async (req, res) => {
    const credentials = requireCredentials(req, res);
    if (!credentials) return;
    const item = requireItem(req, res, credentials);
    if (!item) return;

    await plaidRequest(credentials, '/item/remove', {
      access_token: item.accessToken,
    });
    const items = readItems();
    delete items[req.body.itemId];
    writeItems(items);

    res.send({ status: 'ok', data: {} });
  }),
);

/** The fields Actual reads from a `/transactions/sync` transaction. */
type PlaidTransaction = {
  transaction_id: string;
  amount: number;
  iso_currency_code: string | null;
  unofficial_currency_code: string | null;
  date: string;
  name: string;
  merchant_name: string | null;
  pending: boolean;
  pending_transaction_id: string | null;
};

type PlaidBalanceAccount = {
  account_id: string;
  type: string;
  balances: {
    current: number | null;
    iso_currency_code: string | null;
    unofficial_currency_code: string | null;
  };
};

type PlaidSyncPage = {
  added: PlaidTransaction[];
  modified: PlaidTransaction[];
  accounts: PlaidBalanceAccount[];
  next_cursor: string;
  has_more: boolean;
  transactions_update_status: string;
};

/** Whether Plaid holds the account's history from `startDate` on. */
function hasHistoryFrom(page: PlaidSyncPage, startDate: unknown) {
  if (page.transactions_update_status === 'HISTORICAL_UPDATE_COMPLETE') {
    return true;
  }
  const lastThirtyDays = new Date(Date.now() - 30 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return (
    page.transactions_update_status === 'INITIAL_UPDATE_COMPLETE' &&
    typeof startDate === 'string' &&
    startDate >= lastThirtyDays
  );
}

app.post(
  '/transactions',
  handlePlaidError(async (req, res) => {
    const credentials = requireCredentials(req, res);
    if (!credentials) return;
    const item = requireItem(req, res, credentials);
    if (!item) return;

    const { accountId, cursor: startCursor, startDate } = req.body;
    if (
      typeof accountId !== 'string' ||
      (startCursor !== undefined && typeof startCursor !== 'string')
    ) {
      res.status(400).send({
        status: 'error',
        reason: 'invalid-request',
        details: 'accountId is required and cursor must be a string',
      });
      return;
    }

    // Each account has its own update stream, so syncing one account never
    // consumes another's changes. No cursor means all history Plaid has. The core
    // keeps the cursor and saves the returned one after its import. Plaid's
    // `removed` list is ignored, as no provider deletes transactions.
    let cursor: string | undefined = startCursor;
    const changes: PlaidTransaction[] = [];
    let page: PlaidSyncPage;
    do {
      page = await plaidRequest<PlaidSyncPage>(
        credentials,
        '/transactions/sync',
        {
          access_token: item.accessToken,
          ...(cursor ? { cursor } : {}),
          options: { account_id: accountId },
        },
      );
      // Plaid loads the last 30 days first, then older history. The core
      // waits or retries until the history from its start date is in.
      if (!startCursor && !hasHistoryFrom(page, startDate)) {
        res.send({ status: 'ok', data: { historyPending: true } });
        return;
      }
      changes.push(...page.added, ...page.modified);
      cursor = page.next_cursor;
    } while (page.has_more);
    // An account with no history can be missing from the sync response.
    const account =
      page.accounts.find(candidate => candidate.account_id === accountId) ??
      (
        await plaidRequest<{ accounts: PlaidBalanceAccount[] }>(
          credentials,
          '/accounts/get',
          {
            access_token: item.accessToken,
            options: { account_ids: [accountId] },
          },
        )
      ).accounts[0];
    const current = account?.balances.current ?? null;
    // Plaid reports credit and loan balances as the positive amount owed.
    const startingBalance =
      current === null
        ? null
        : String(
            account?.type === 'credit' || account?.type === 'loan'
              ? -current
              : current,
          );
    const currency =
      account?.balances.iso_currency_code ??
      account?.balances.unofficial_currency_code ??
      null;

    // Plaid amounts are positive when money leaves the account.
    const all = changes
      .map(trans => ({
        transactionId: trans.transaction_id,
        booked: !trans.pending,
        date: trans.date,
        payeeName: trans.merchant_name || trans.name,
        transactionAmount: {
          amount: String(-trans.amount),
          currency: trans.iso_currency_code ?? trans.unofficial_currency_code,
        },
        pendingTransactionId: trans.pending_transaction_id ?? undefined,
      }))
      .sort((a, b) => b.date.localeCompare(a.date));

    res.send({
      status: 'ok',
      data: {
        balances:
          startingBalance === null
            ? []
            : [
                {
                  balanceAmount: { amount: startingBalance, currency },
                  balanceType: 'expected',
                },
              ],
        startingBalance,
        startingBalanceCurrency: currency,
        nextCursor: cursor,
        transactions: {
          all,
          booked: all.filter(trans => trans.booked),
          pending: all.filter(trans => !trans.booked),
        },
      },
    });
  }),
);
