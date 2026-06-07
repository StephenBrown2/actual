import type { Request, Response } from 'express';
import express from 'express';
import {
  Configuration,
  CountryCode,
  PlaidApi,
  PlaidEnvironments,
  Products,
} from 'plaid';

import { handleError } from '#app-gocardless/util/handle-error';
import { SecretName, secretsService } from '#services/secrets-service';
import {
  requestLoggerMiddleware,
  validateSessionMiddleware,
} from '#util/middlewares';

import type { PlaidAccessTokenMap } from './plaid.types';

const app = express();
export { app as handlers };
app.use(requestLoggerMiddleware);
app.use(express.json());
app.use(validateSessionMiddleware);

function getPlaidClient(): PlaidApi | null {
  const clientId = secretsService.get(SecretName.plaid_clientId);
  const secret = secretsService.get(SecretName.plaid_secret);
  const env = secretsService.get(SecretName.plaid_env) ?? 'sandbox';

  if (!clientId || !secret) {
    return null;
  }

  const basePath =
    PlaidEnvironments[env as keyof typeof PlaidEnvironments] ??
    PlaidEnvironments.sandbox;

  const config = new Configuration({
    basePath,
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': clientId,
        'PLAID-SECRET': secret,
      },
    },
  });

  return new PlaidApi(config);
}

function getAccessTokens(): PlaidAccessTokenMap {
  const raw = secretsService.get(SecretName.plaid_accessTokens);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as PlaidAccessTokenMap;
  } catch {
    return {};
  }
}

function setAccessToken(itemId: string, accessToken: string): void {
  const tokens = getAccessTokens();
  tokens[itemId] = accessToken;
  secretsService.set(SecretName.plaid_accessTokens, JSON.stringify(tokens));
}

app.post(
  '/status',
  handleError(async (_req: Request, res: Response) => {
    const clientId = secretsService.get(SecretName.plaid_clientId);
    const secret = secretsService.get(SecretName.plaid_secret);
    const configured =
      clientId != null &&
      clientId !== 'Forbidden' &&
      secret != null &&
      secret !== 'Forbidden';

    res.send({
      status: 'ok',
      data: { configured },
    });
  }),
);

app.post(
  '/create-link-token',
  handleError(async (req: Request, res: Response) => {
    const plaid = getPlaidClient();
    if (!plaid) {
      res.send({
        status: 'ok',
        data: {
          error_type: 'CONFIGURATION_ERROR',
          error_code: 'NOT_CONFIGURED',
        },
      });
      return;
    }

    const { userId } = req.body || {};

    const response = await plaid.linkTokenCreate({
      user: { client_user_id: userId ?? 'actual-user' },
      client_name: 'Actual Budget',
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: 'en',
      hosted_link: {},
    });

    res.send({
      status: 'ok',
      data: {
        link_token: response.data.link_token,
        hosted_link_url: response.data.hosted_link_url ?? null,
      },
    });
  }),
);

app.post(
  '/exchange-token',
  handleError(async (req: Request, res: Response) => {
    const plaid = getPlaidClient();
    if (!plaid) {
      res.send({
        status: 'ok',
        data: {
          error_type: 'CONFIGURATION_ERROR',
          error_code: 'NOT_CONFIGURED',
        },
      });
      return;
    }

    const { publicToken } = req.body || {};
    if (!publicToken) {
      res.send({
        status: 'ok',
        data: {
          error_type: 'INVALID_INPUT',
          error_code: 'MISSING_PUBLIC_TOKEN',
        },
      });
      return;
    }

    const exchangeResponse = await plaid.itemPublicTokenExchange({
      public_token: publicToken,
    });
    const { access_token: accessToken, item_id: itemId } =
      exchangeResponse.data;

    setAccessToken(itemId, accessToken);

    const accountsResponse = await plaid.accountsGet({
      access_token: accessToken,
    });

    const accounts = accountsResponse.data.accounts.map(a => ({
      account_id: `${itemId}:${a.account_id}`,
      name: a.name,
      official_name: a.official_name ?? null,
      type: a.type,
      subtype: a.subtype ?? null,
      mask: a.mask ?? null,
      institution: accountsResponse.data.item.institution_id ?? null,
      iso_currency_code: a.balances.iso_currency_code ?? null,
    }));

    res.send({
      status: 'ok',
      data: { accounts, itemId },
    });
  }),
);

app.post(
  '/poll-link-token',
  handleError(async (req: Request, res: Response) => {
    const plaid = getPlaidClient();
    if (!plaid) {
      res.send({
        status: 'ok',
        data: {
          error_type: 'CONFIGURATION_ERROR',
          error_code: 'NOT_CONFIGURED',
        },
      });
      return;
    }

    const { linkToken } = req.body || {};
    if (!linkToken) {
      res.send({
        status: 'ok',
        data: { error_type: 'INVALID_INPUT', error_code: 'MISSING_LINK_TOKEN' },
      });
      return;
    }

    const response = await plaid.linkTokenGet({ link_token: linkToken });
    const sessions = response.data.link_sessions;
    const publicToken =
      sessions &&
      sessions.length > 0 &&
      sessions[sessions.length - 1].results?.item_add_results?.[0]
        ?.public_token;

    if (publicToken) {
      res.send({ status: 'ok', data: { publicToken } });
    } else {
      // Session not yet complete; caller should retry
      res.send({ status: 'ok', data: null });
    }
  }),
);

app.post(
  '/accounts',
  handleError(async (_req: Request, res: Response) => {
    const plaid = getPlaidClient();
    if (!plaid) {
      res.send({
        status: 'ok',
        data: {
          error_type: 'CONFIGURATION_ERROR',
          error_code: 'NOT_CONFIGURED',
        },
      });
      return;
    }

    const tokens = getAccessTokens();
    const allAccounts: unknown[] = [];

    for (const [itemId, accessToken] of Object.entries(tokens)) {
      try {
        const response = await plaid.accountsGet({ access_token: accessToken });
        for (const a of response.data.accounts) {
          allAccounts.push({
            account_id: `${itemId}:${a.account_id}`,
            name: a.name,
            official_name: a.official_name ?? null,
            type: a.type,
            subtype: a.subtype ?? null,
            mask: a.mask ?? null,
            balance: a.balances.current,
            institution: response.data.item.institution_id ?? null,
            iso_currency_code: a.balances.iso_currency_code ?? null,
          });
        }
      } catch {
        // skip items with expired/revoked tokens
      }
    }

    res.send({
      status: 'ok',
      data: { accounts: allAccounts },
    });
  }),
);

app.post(
  '/transactions',
  handleError(async (req: Request, res: Response) => {
    const plaid = getPlaidClient();
    if (!plaid) {
      res.send({
        status: 'ok',
        data: {
          error_type: 'CONFIGURATION_ERROR',
          error_code: 'NOT_CONFIGURED',
        },
      });
      return;
    }

    const { accountId, startDate } = req.body || {};
    if (!accountId || !startDate) {
      res.send({
        status: 'ok',
        data: {
          error_type: 'INVALID_INPUT',
          error_code: 'MISSING_PARAMETERS',
        },
      });
      return;
    }

    const [itemId, plaidAccountId] = (accountId as string).split(':');
    const accessToken = getAccessTokens()[itemId];

    if (!accessToken) {
      res.send({
        status: 'ok',
        data: {
          error_type: 'ITEM_ERROR',
          error_code: 'ITEM_LOGIN_REQUIRED',
        },
      });
      return;
    }

    const endDate = new Date().toISOString().split('T')[0];

    const response = await plaid.transactionsGet({
      access_token: accessToken,
      start_date: startDate as string,
      end_date: endDate,
      options: { account_ids: [plaidAccountId] },
    });

    const allTransactions = response.data.transactions;

    const toNormalized = (t: (typeof allTransactions)[number]) => ({
      transactionId: t.transaction_id,
      date: t.date,
      payeeName: t.merchant_name ?? t.name,
      notes: t.name,
      transactionAmount: {
        amount: String(-t.amount),
        currency: t.iso_currency_code ?? 'USD',
      },
      booked: !t.pending,
    });

    const booked = allTransactions.filter(t => !t.pending).map(toNormalized);
    const pending = allTransactions.filter(t => t.pending).map(toNormalized);

    const balanceResponse = await plaid.accountsBalanceGet({
      access_token: accessToken,
      options: { account_ids: [plaidAccountId] },
    });
    const acct = balanceResponse.data.accounts[0];
    const currentBalance = acct
      ? Math.round((acct.balances.current ?? 0) * 100)
      : 0;
    const currency = acct?.balances.iso_currency_code ?? 'USD';

    res.send({
      status: 'ok',
      data: {
        transactions: {
          all: [...booked, ...pending],
          booked,
          pending,
        },
        balances: [
          {
            balanceAmount: {
              amount: String((acct?.balances.current ?? 0).toFixed(2)),
              currency,
            },
            balanceType: 'expected',
            referenceDate: endDate,
          },
        ],
        startingBalance: currentBalance,
      },
    });
  }),
);
