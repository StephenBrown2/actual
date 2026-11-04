import { send, sendCatch } from '@actual-app/core/platform/client/connection';
import type { AccountEntity, PlaidItem } from '@actual-app/core/types/models';
import { t } from 'i18next';

import { pushModal } from '#modals/modalsSlice';
import { addNotification } from '#notifications/notificationsSlice';
import type { AppDispatch } from '#redux/store';

/** Countries Plaid's /link/token/create accepts. */
export const PLAID_COUNTRY_CODES = [
  'US',
  'CA',
  'GB',
  'IE',
  'FR',
  'ES',
  'NL',
  'DE',
  'IT',
  'PL',
  'DK',
  'NO',
  'SE',
  'EE',
  'LT',
  'LV',
  'PT',
  'BE',
  'AT',
  'FI',
];

export function plaidErrorMessage(error: { code?: string; message?: string }) {
  return error.code ?? error.message ?? t('Unknown error');
}

export function notifyPlaidError(dispatch: AppDispatch, message: string) {
  dispatch(
    addNotification({
      notification: {
        type: 'error',
        title: t('Error when trying to contact Plaid'),
        message,
        timeout: 5000,
      },
    }),
  );
}

/** Lists the Item's accounts for the user to map to Actual accounts. */
export async function selectPlaidAccounts(
  dispatch: AppDispatch,
  item: PlaidItem,
  upgradingAccountId?: AccountEntity['id'],
) {
  const result = await sendCatch('plaid-accounts', item);
  if (result.error) {
    notifyPlaidError(dispatch, plaidErrorMessage(result.error));
    return;
  }
  dispatch(
    pushModal({
      modal: {
        name: 'select-linked-accounts',
        options: {
          externalAccounts: result.data,
          syncSource: 'plaid',
          upgradingAccountId,
        },
      },
    }),
  );
}

// The server starts a new connection when no Item id is given, so a missing
// one stops here.
async function linkedItemId(
  dispatch: AppDispatch,
  accountId: AccountEntity['id'],
) {
  const itemId = await send('plaid-account-item-id', { id: accountId });
  if (!itemId) {
    notifyPlaidError(dispatch, t('This account is not linked to Plaid.'));
  }
  return itemId;
}

/** Opens update-mode Link so the user can log in to the account's bank again. */
export async function startPlaidRepair(
  dispatch: AppDispatch,
  accountId: AccountEntity['id'],
) {
  const itemId = await linkedItemId(dispatch, accountId);
  if (itemId) {
    dispatch(
      pushModal({
        modal: { name: 'plaid-link', options: { update: { itemId } } },
      }),
    );
  }
}

/** Removes the account's Item from Plaid. Returns false on failure. */
export async function removePlaidConnection(
  dispatch: AppDispatch,
  accountId: AccountEntity['id'],
) {
  const itemId = await linkedItemId(dispatch, accountId);
  if (!itemId) return false;
  const result = await sendCatch('plaid-remove-item', { itemId });
  if (result.error) {
    notifyPlaidError(dispatch, plaidErrorMessage(result.error));
    return false;
  }
  return true;
}
