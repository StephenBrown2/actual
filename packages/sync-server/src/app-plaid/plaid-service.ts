import { SecretName, secretsService } from '#services/secrets-service';

const BASE_URLS = {
  sandbox: 'https://sandbox.plaid.com',
  production: 'https://production.plaid.com',
};

export type PlaidCredentials = {
  source: 'per-budget-file' | 'global';
  clientId: string;
  secret: string;
  environment: keyof typeof BASE_URLS;
  trialPlan: boolean;
  countryCodes: string[];
};

export type PlaidItem = {
  ownerUserId: string;
  clientId: string;
  environment: PlaidCredentials['environment'];
  accessToken: string;
  institutionId: string | null;
  institutionName: string | null;
  products: string[];
};

// Kept out of SecretName so the /secret routes can never read or overwrite
// stored access tokens.
const ITEMS_SECRET = 'plaid_items';

export class PlaidError extends Error {
  constructor(
    readonly code: string,
    /** Plaid's explanation, shown to the user. */
    readonly displayMessage?: string,
  ) {
    super(code);
  }
}

function readCredentials(fileId?: string) {
  const clientId = secretsService.get(SecretName.plaid_clientId, fileId);
  const secret = secretsService.get(SecretName.plaid_secret, fileId);
  const environment = secretsService.get(SecretName.plaid_environment, fileId);
  if (
    !clientId ||
    !secret ||
    (environment !== 'sandbox' && environment !== 'production')
  ) {
    return null;
  }
  return {
    clientId,
    secret,
    environment,
    trialPlan:
      secretsService.get(SecretName.plaid_trialPlan, fileId) === 'true',
    // Plaid rejects a link token naming a country the team is not approved
    // for in Production, so the user picks them.
    countryCodes: (
      secretsService.get(SecretName.plaid_countryCodes, fileId) ?? 'US'
    )
      .split(',')
      .filter(Boolean),
  } satisfies Omit<PlaidCredentials, 'source'>;
}

// Credentials saved for the budget file win over the global ones.
export function getCredentials(
  fileId: string | undefined,
): PlaidCredentials | null {
  const perFile = fileId ? readCredentials(fileId) : null;
  if (perFile) {
    return { source: 'per-budget-file', ...perFile };
  }
  const global = readCredentials();
  return global && { source: 'global', ...global };
}

export async function plaidRequest<T>(
  credentials: PlaidCredentials,
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(BASE_URLS[credentials.environment] + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Plaid-Version': '2020-09-14',
    },
    body: JSON.stringify({
      client_id: credentials.clientId,
      secret: credentials.secret,
      ...body,
    }),
  });
  // Plaid's documented response shape is trusted rather than validated.
  const data = (await res.json()) as T & {
    error_code?: string;
    error_message?: string;
    display_message?: string | null;
  };
  if (!res.ok) {
    throw new PlaidError(
      data?.error_code ?? `HTTP_${res.status}`,
      data?.display_message ?? data?.error_message,
    );
  }
  return data;
}

export function readItems(): Record<string, PlaidItem> {
  return JSON.parse(secretsService.get(ITEMS_SECRET) ?? '{}');
}

export function writeItems(items: Record<string, PlaidItem>) {
  secretsService.set(ITEMS_SECRET, JSON.stringify(items));
}

// An Item is reusable only by the user who linked it, with the client_id and
// environment that created its access token.
export function isUsableItem(
  item: PlaidItem | undefined,
  userId: string,
  credentials: PlaidCredentials,
) {
  return (
    item?.ownerUserId === userId &&
    item.clientId === credentials.clientId &&
    item.environment === credentials.environment
  );
}

export function getOwnedItem(
  itemId: unknown,
  userId: string,
  credentials: PlaidCredentials,
): PlaidItem | null {
  if (typeof itemId !== 'string') {
    return null;
  }
  // Inherited keys such as "constructor" have no ownerUserId, so they fail
  // the owner check.
  const item: PlaidItem | undefined = readItems()[itemId];
  return item && isUsableItem(item, userId, credentials) ? item : null;
}

// ponytail: in memory, so a restart costs one rejected request per team.
const investmentsUnavailable = new Set<string>();

export type LinkTokenResponse = {
  link_token: string;
  hosted_link_url: string;
};

export async function createLinkToken(
  credentials: PlaidCredentials,
  base: Record<string, unknown>,
): Promise<LinkTokenResponse> {
  const key = `${credentials.environment}:${credentials.clientId}`;
  // Plaid's default is 90 days and an Item's history cannot grow later, so ask
  // for the most it allows.
  const request = {
    ...base,
    products: ['transactions'],
    transactions: { days_requested: 730 },
  };
  if (!investmentsUnavailable.has(key)) {
    try {
      return await plaidRequest(credentials, '/link/token/create', {
        ...request,
        optional_products: ['investments'],
      });
    } catch (error) {
      // Plaid answers INVALID_PRODUCT when the team lacks Investments.
      if (!(error instanceof PlaidError && error.code === 'INVALID_PRODUCT')) {
        throw error;
      }
      investmentsUnavailable.add(key);
    }
  }
  return plaidRequest(credentials, '/link/token/create', request);
}
