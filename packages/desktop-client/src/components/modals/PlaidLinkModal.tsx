import { useEffect, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button, ButtonWithLoading } from '@actual-app/components/button';
import { Paragraph } from '@actual-app/components/paragraph';
import { Select } from '@actual-app/components/select';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { sendCatch } from '@actual-app/core/platform/client/connection';
import type { PlaidItem } from '@actual-app/core/types/models';

import { Error as ErrorAlert, Warning } from '#components/alerts';
import {
  Modal,
  ModalButtons,
  ModalCloseButton,
  ModalHeader,
} from '#components/common/Modal';
import { closeModal } from '#modals/modalsSlice';
import type { Modal as ModalType } from '#modals/modalsSlice';
import {
  notifyPlaidError,
  plaidErrorMessage,
  selectPlaidAccounts,
} from '#plaid';
import { useDispatch } from '#redux';

type PlaidLinkModalProps = Extract<
  ModalType,
  { name: 'plaid-link' }
>['options'];

type HostedLink = { linkToken: string; hostedLinkUrl: string };

const POLL_INTERVAL_MS = 3000;
// Plaid's Hosted Link URL lasts 30 minutes by default.
const LINK_LIFETIME_MS = 30 * 60 * 1000;

export function PlaidLinkModal({
  trialPlan = false,
  upgradingAccountId,
  update,
}: PlaidLinkModalProps) {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const [items, setItems] = useState<PlaidItem[] | null>(null);
  // Each new connection uses one of the Trial plan's lifetime slots.
  const [mode, setMode] = useState<'existing' | 'new'>(
    trialPlan ? 'existing' : 'new',
  );
  const [itemId, setItemId] = useState('');
  const [link, setLink] = useState<HostedLink | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  // Plaid must not open after the dialog closes, since nothing would wait
  // for its result.
  const isClosed = useRef(false);
  useEffect(() => {
    isClosed.current = false;
    return () => {
      isClosed.current = true;
    };
  }, []);

  useEffect(() => {
    if (update) return;
    void sendCatch('plaid-items').then(({ data, error }) => {
      if (error) {
        setError(plaidErrorMessage(error));
        setItems([]);
        return;
      }
      setItems(data.items);
      setItemId(data.items[0]?.itemId ?? '');
    });
  }, [update]);

  // Plaid's page runs in another window, so wait for it to report the result.
  useEffect(() => {
    if (!link) return;
    const { linkToken } = link;
    let stopped = false;
    const deadline = Date.now() + LINK_LIFETIME_MS;

    async function finish(publicToken?: string) {
      dispatch(closeModal());
      // Update mode keeps the Item's access token, so it adds no Item.
      if (update) return;
      if (!publicToken) {
        notifyPlaidError(dispatch, t('Plaid did not return a connection.'));
        return;
      }
      const result = await sendCatch('plaid-exchange', { publicToken });
      if (result.error) {
        notifyPlaidError(dispatch, plaidErrorMessage(result.error));
        return;
      }
      await selectPlaidAccounts(dispatch, result.data.item, upgradingAccountId);
    }

    async function poll() {
      while (Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
        if (stopped) return;
        const { data, error } = await sendCatch('plaid-link-result', {
          linkToken,
        });
        if (stopped) return;
        // Plaid's window may still finish, so keep waiting on the same session.
        if (error) {
          setError(plaidErrorMessage(error));
          continue;
        }
        setError(null);
        if (data.status === 'exited') {
          setError(t('Plaid was closed before linking finished.'));
          setLink(null);
          return;
        }
        if (data.status === 'success') {
          await finish(data.publicToken);
          return;
        }
      }
      setError(t('Linking took too long. Try again.'));
      setLink(null);
    }

    void poll();
    return () => {
      stopped = true;
    };
  }, [link, update, upgradingAccountId, dispatch, t]);

  const hasItems = items !== null && items.length > 0;
  const selectedMode = update || items?.length === 0 ? 'new' : mode;

  async function onContinue() {
    setIsLoading(true);
    setError(null);
    if (selectedMode === 'existing') {
      const item = items?.find(candidate => candidate.itemId === itemId);
      if (item) {
        dispatch(closeModal());
        await selectPlaidAccounts(dispatch, item, upgradingAccountId);
      }
      setIsLoading(false);
      return;
    }

    const { data, error } = await sendCatch(
      'plaid-link-token',
      update ? { itemId: update.itemId } : {},
    );
    if (isClosed.current) return;
    setIsLoading(false);
    if (error) {
      setError(plaidErrorMessage(error));
      return;
    }
    window.Actual.openURLInBrowser(data.hostedLinkUrl);
    setLink(data);
  }

  return (
    <Modal name="plaid-link" containerProps={{ style: { width: '30vw' } }}>
      {({ state }) => (
        <>
          <ModalHeader
            title={t('Link a bank with Plaid')}
            rightContent={<ModalCloseButton onPress={() => state.close()} />}
          />
          <View style={{ gap: 10 }}>
            {link ? (
              <>
                <Paragraph style={{ marginBottom: 0 }}>
                  <Trans>
                    Finish in the Plaid window. This dialog continues when you
                    are done.
                  </Trans>
                </Paragraph>
                <Button
                  onPress={() =>
                    window.Actual.openURLInBrowser(link.hostedLinkUrl)
                  }
                >
                  <Trans>Open Plaid again</Trans>
                </Button>
              </>
            ) : update ? (
              <Paragraph style={{ marginBottom: 0 }}>
                <Trans>
                  Plaid opens in a new window so you can log in to your bank
                  again.
                </Trans>
              </Paragraph>
            ) : (
              <>
                <label style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="radio"
                    name="plaid-link-mode"
                    checked={selectedMode === 'existing'}
                    disabled={!hasItems}
                    onChange={() => setMode('existing')}
                  />
                  <Trans>Use an existing connection</Trans>
                </label>
                {selectedMode === 'existing' && hasItems && (
                  <Select
                    aria-label={t('Connection')}
                    value={itemId}
                    options={items.map(item => [
                      item.itemId,
                      item.institutionName ?? item.itemId,
                    ])}
                    onChange={setItemId}
                  />
                )}
                {items?.length === 0 && (
                  <Text style={{ color: theme.pageTextSubdued }}>
                    <Trans>No saved connections yet.</Trans>
                  </Text>
                )}

                <label style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="radio"
                    name="plaid-link-mode"
                    checked={selectedMode === 'new'}
                    onChange={() => setMode('new')}
                  />
                  <Trans>Link a new bank</Trans>
                </label>
                {trialPlan && (
                  <Warning>
                    <Trans>
                      Each new connection uses one of the Trial plan&apos;s 10
                      lifetime connections, and removing it does not give the
                      connection back.
                    </Trans>
                  </Warning>
                )}
              </>
            )}

            {error && <ErrorAlert>{error}</ErrorAlert>}
          </View>

          {!link && (
            <ModalButtons>
              <ButtonWithLoading
                variant="primary"
                isLoading={isLoading}
                isDisabled={!update && items === null}
                onPress={() => void onContinue()}
              >
                <Trans>Continue</Trans>
              </ButtonWithLoading>
            </ModalButtons>
          )}
        </>
      )}
    </Modal>
  );
}
