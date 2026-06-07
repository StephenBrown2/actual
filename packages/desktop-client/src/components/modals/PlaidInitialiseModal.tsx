import React, { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { ButtonWithLoading } from '@actual-app/components/button';
import { Input } from '@actual-app/components/input';
import { Select } from '@actual-app/components/select';
import { Text } from '@actual-app/components/text';
import { View } from '@actual-app/components/view';
import { send } from '@actual-app/core/platform/client/connection';
import { getSecretsError } from '@actual-app/core/shared/errors';

import { Error } from '#components/alerts';
import { Link } from '#components/common/Link';
import {
  Modal,
  ModalButtons,
  ModalCloseButton,
  ModalHeader,
} from '#components/common/Modal';
import { FormField, FormLabel } from '#components/forms';
import type { Modal as ModalType } from '#modals/modalsSlice';

type PlaidInitialiseModalProps = Extract<
  ModalType,
  { name: 'plaid-init' }
>['options'];

export function PlaidInitialiseModal({ onSuccess }: PlaidInitialiseModalProps) {
  const { t } = useTranslation();
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [env, setEnv] = useState<'sandbox' | 'production'>('sandbox');
  const [isValid, setIsValid] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const onSubmit = async (close: () => void) => {
    if (!clientId || !secret) {
      setIsValid(false);
      setError(t('Client ID and Secret are required.'));
      return;
    }

    setIsLoading(true);

    const clientIdResult =
      (await send('secret-set', {
        name: 'plaid_clientId',
        value: clientId,
      })) || {};

    if ('error' in clientIdResult && clientIdResult.error) {
      setIsValid(false);
      setError(
        getSecretsError(
          clientIdResult.error as string,
          (clientIdResult.reason as string | undefined) ?? '',
        ),
      );
      setIsLoading(false);
      return;
    }

    const secretResult =
      (await send('secret-set', {
        name: 'plaid_secret',
        value: secret,
      })) || {};

    if ('error' in secretResult && secretResult.error) {
      setIsValid(false);
      setError(
        getSecretsError(
          secretResult.error as string,
          (secretResult.reason as string | undefined) ?? '',
        ),
      );
      setIsLoading(false);
      return;
    }

    await send('secret-set', {
      name: 'plaid_env',
      value: env,
    });

    onSuccess();
    setIsLoading(false);
    close();
  };

  return (
    <Modal name="plaid-init" containerProps={{ style: { width: 320 } }}>
      {({ state }) => (
        <>
          <ModalHeader
            title={t('Set up Plaid')}
            rightContent={<ModalCloseButton onPress={() => state.close()} />}
          />
          <View style={{ display: 'flex', gap: 10 }}>
            <Text>
              <Trans>
                Connect US/Canadian bank accounts via{' '}
                <Link
                  variant="external"
                  to="https://dashboard.plaid.com/overview"
                  linkColor="purple"
                >
                  Plaid
                </Link>
                . You need a Plaid developer account with Client ID and Secret.
              </Trans>
            </Text>

            <FormField>
              <FormLabel title={t('Environment:')} htmlFor="plaid-env-field" />
              <Select
                id="plaid-env-field"
                value={env}
                onChange={value => setEnv(value as 'sandbox' | 'production')}
                options={[
                  ['sandbox', t('Sandbox (testing)')],
                  ['production', t('Production')],
                ]}
              />
            </FormField>

            <FormField>
              <FormLabel
                title={t('Client ID:')}
                htmlFor="plaid-client-id-field"
              />
              <Input
                id="plaid-client-id-field"
                type="text"
                value={clientId}
                onChangeValue={value => {
                  setClientId(value);
                  setIsValid(true);
                }}
              />
            </FormField>

            <FormField>
              <FormLabel title={t('Secret:')} htmlFor="plaid-secret-field" />
              <Input
                id="plaid-secret-field"
                type="password"
                value={secret}
                onChangeValue={value => {
                  setSecret(value);
                  setIsValid(true);
                }}
              />
            </FormField>

            {!isValid && <Error>{error}</Error>}
          </View>

          <ModalButtons>
            <ButtonWithLoading
              variant="primary"
              autoFocus
              isLoading={isLoading}
              onPress={() => {
                void onSubmit(() => state.close());
              }}
            >
              <Trans>Save and continue</Trans>
            </ButtonWithLoading>
          </ModalButtons>
        </>
      )}
    </Modal>
  );
}
