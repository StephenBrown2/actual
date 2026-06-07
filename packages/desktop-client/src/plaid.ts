import { send } from '@actual-app/core/platform/client/connection';
import { isElectron } from '@actual-app/core/shared/environment';
import type { SyncServerPlaidAccount } from '@actual-app/core/types/models';

import { pushModal } from './modals/modalsSlice';
import type { AppDispatch } from './redux/store';

// Open Plaid's Hosted Link URL. Plaid hosts the entire Link flow on their
// domain, so no Plaid SDK, COEP conflicts, or CSP issues arise in the main
// app. In Electron, the system browser handles it; on the web, a popup window
// is used so the user stays in context while the server-side poll waits.
function openHostedLink(url: string): void {
  if (isElectron()) {
    window.Actual.openURLInBrowser(url);
  } else {
    window.open(
      url,
      'plaid-link',
      'width=500,height=700,scrollbars=yes,resizable=yes',
    );
  }
}

export async function authorizeBank(
  dispatch: AppDispatch,
  upgradingAccountId?: string,
) {
  const linkTokenResult = await send('plaid-create-link-token', {});

  if (
    !linkTokenResult ||
    'error' in linkTokenResult ||
    !('link_token' in linkTokenResult)
  ) {
    throw new Error(
      'link_token' in linkTokenResult
        ? String(linkTokenResult.link_token)
        : 'Failed to create Plaid link token',
    );
  }

  const { link_token: linkToken, hosted_link_url: hostedLinkUrl } =
    linkTokenResult as { link_token: string; hosted_link_url: string | null };

  if (!hostedLinkUrl) {
    throw new Error(
      'Plaid Hosted Link URL not returned. Ensure hosted_link is enabled for this Plaid client.',
    );
  }

  openHostedLink(hostedLinkUrl);

  const pollResult = await send('plaid-poll-link-token', { linkToken });

  if (!pollResult || 'error' in pollResult) {
    const err = pollResult as { error: string; message?: string } | undefined;
    if (err?.error === 'timeout') {
      throw new Error(
        'Timed out waiting for Plaid authorization. Please try again.',
      );
    }
    throw new Error(err?.message ?? 'Plaid authorization failed');
  }

  const { publicToken } = (pollResult as { data: { publicToken: string } })
    .data;

  const exchangeResult = await send('plaid-exchange-token', { publicToken });

  if (!exchangeResult || 'error' in exchangeResult) {
    throw new Error('Failed to exchange Plaid token');
  }

  const { accounts } = exchangeResult as {
    accounts: SyncServerPlaidAccount[];
  };

  dispatch(
    pushModal({
      modal: {
        name: 'select-linked-accounts',
        options: {
          externalAccounts: accounts,
          syncSource: 'plaid',
          upgradingAccountId,
        },
      },
    }),
  );
}
