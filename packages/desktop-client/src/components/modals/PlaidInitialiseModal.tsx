import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { ButtonWithLoading } from '@actual-app/components/button';
import { useResponsive } from '@actual-app/components/hooks/useResponsive';
import { InitialFocus } from '@actual-app/components/initial-focus';
import { Input } from '@actual-app/components/input';
import { Select } from '@actual-app/components/select';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { send } from '@actual-app/core/platform/client/connection';

import { Error as ErrorAlert } from '#components/alerts';
import {
  Modal,
  ModalButtons,
  ModalCloseButton,
  ModalHeader,
} from '#components/common/Modal';
import { FormField, FormLabel } from '#components/forms';
import { LabeledCheckbox } from '#components/forms/LabeledCheckbox';
import { ToggleField } from '#components/mobile/MobileForms';
import { useCurrentAccess } from '#hooks/useCurrentAccess';
import type { Modal as ModalType } from '#modals/modalsSlice';
import { PLAID_COUNTRY_CODES } from '#plaid';
import { getSecretsError } from '#util/error';

type PlaidInitialiseModalProps = Extract<
  ModalType,
  { name: 'plaid-init' }
>['options'];

export function PlaidInitialiseModal({
  onSuccess,
  configured,
  trialPlan: initialTrialPlan,
  countryCodes: initialCountryCodes,
}: PlaidInitialiseModalProps) {
  const { t, i18n } = useTranslation();
  const { isNarrowWidth } = useResponsive();
  const { cloudFileId, isAdmin: canSetGlobalCredentials } = useCurrentAccess();
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [environment, setEnvironment] = useState<'sandbox' | 'production'>(
    'sandbox',
  );
  const [trialPlan, setTrialPlan] = useState(initialTrialPlan);
  const [countryCodes, setCountryCodes] = useState(initialCountryCodes);
  const regionNames = new Intl.DisplayNames([i18n.language], {
    type: 'region',
  });
  const countries = PLAID_COUNTRY_CODES.map(
    code => [code, regionNames.of(code) ?? code] as const,
  ).sort(([, a], [, b]) => a.localeCompare(b));
  // Once credentials exist, editing them from a budget keeps the change to
  // that budget unless the user chooses otherwise.
  const [perBudgetFile, setPerBudgetFile] = useState(
    configured || !canSetGlobalCredentials,
  );
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function onSubmit(close: () => void) {
    if (!clientId || !secret) {
      setError(t('Both the client ID and the secret are required.'));
      return;
    }
    if (countryCodes.length === 0) {
      setError(t('Choose at least one country or region.'));
      return;
    }
    const fileId = perBudgetFile ? cloudFileId : null;
    if (perBudgetFile && !fileId) {
      setError(t('Budget file ID is required.'));
      return;
    }

    setIsLoading(true);
    const secrets = [
      ['plaid_clientId', clientId],
      ['plaid_secret', secret],
      ['plaid_environment', environment],
      ['plaid_trialPlan', String(trialPlan)],
      // Kept in Plaid's list order so the saved value is stable.
      [
        'plaid_countryCodes',
        PLAID_COUNTRY_CODES.filter(code => countryCodes.includes(code)).join(
          ',',
        ),
      ],
    ];
    for (const [name, value] of secrets) {
      const result = await send('secret-set', { name, value, fileId });
      if (result?.error) {
        setIsLoading(false);
        setError(getSecretsError(result.error, result.reason));
        return;
      }
    }

    onSuccess({
      configured: true,
      source: perBudgetFile ? 'per-budget-file' : 'global',
      trialPlan,
      countryCodes,
    });
    setIsLoading(false);
    close();
  }

  return (
    <Modal name="plaid-init" containerProps={{ style: { width: '34vw' } }}>
      {({ state }) => (
        <>
          <ModalHeader
            title={t('Set up Plaid')}
            rightContent={<ModalCloseButton onPress={() => state.close()} />}
          />
          <View style={{ display: 'flex', gap: 10 }}>
            <Text>
              <Trans>
                Enter the client ID and secret from the Keys page of your Plaid
                Dashboard.
              </Trans>
            </Text>

            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: isNarrowWidth ? 'space-between' : 'flex-start',
                gap: 12,
              }}
            >
              {isNarrowWidth ? (
                <label htmlFor="plaid-per-budget-file">
                  <Text>
                    {perBudgetFile ? (
                      <Trans>For this budget only</Trans>
                    ) : (
                      <Trans>For all budgets</Trans>
                    )}
                  </Text>
                </label>
              ) : (
                <label htmlFor="plaid-per-budget-file">
                  <Text style={toggleSideStyle(!perBudgetFile)}>
                    <Trans>All budgets</Trans>
                  </Text>
                </label>
              )}
              <ToggleField
                id="plaid-per-budget-file"
                aria-label={t('For this budget only')}
                isOn={perBudgetFile}
                isDisabled={!canSetGlobalCredentials}
                onToggle={setPerBudgetFile}
              />
              {!isNarrowWidth && (
                <label htmlFor="plaid-per-budget-file">
                  <Text style={toggleSideStyle(perBudgetFile)}>
                    <Trans>This budget only</Trans>
                  </Text>
                </label>
              )}
            </View>

            <FormField>
              <FormLabel title={t('Client ID:')} htmlFor="plaid-client-id" />
              <InitialFocus>
                <Input
                  id="plaid-client-id"
                  value={clientId}
                  onChangeValue={value => {
                    setClientId(value);
                    setError(null);
                  }}
                />
              </InitialFocus>
            </FormField>

            <FormField>
              <FormLabel title={t('Secret:')} htmlFor="plaid-secret" />
              <Input
                id="plaid-secret"
                type="password"
                value={secret}
                onChangeValue={value => {
                  setSecret(value);
                  setError(null);
                }}
              />
            </FormField>

            <FormField>
              <FormLabel
                title={t('Environment:')}
                htmlFor="plaid-environment"
              />
              <Select
                id="plaid-environment"
                value={environment}
                options={[
                  ['sandbox', t('Sandbox')],
                  ['production', t('Production')],
                ]}
                onChange={setEnvironment}
              />
            </FormField>

            <LabeledCheckbox
              id="plaid-trial-plan"
              checked={trialPlan}
              onChange={() => setTrialPlan(!trialPlan)}
            >
              <Trans>My Plaid team is on the Trial plan</Trans>
            </LabeledCheckbox>

            <FormField>
              <FormLabel title={t('Countries and regions:')} />
              <Text style={{ color: theme.pageTextSubdued, marginBottom: 5 }}>
                <Trans>
                  Choose only those your Plaid team is approved for. Plaid
                  rejects the others in Production.
                </Trans>
              </Text>
              <View
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
                  gap: 4,
                }}
              >
                {countries.map(([code, name]) => (
                  <LabeledCheckbox
                    key={code}
                    id={`plaid-country-${code}`}
                    checked={countryCodes.includes(code)}
                    onChange={() => {
                      setCountryCodes(
                        countryCodes.includes(code)
                          ? countryCodes.filter(c => c !== code)
                          : [...countryCodes, code],
                      );
                      setError(null);
                    }}
                  >
                    {name}
                  </LabeledCheckbox>
                ))}
              </View>
            </FormField>

            {error && <ErrorAlert>{error}</ErrorAlert>}
          </View>

          <ModalButtons>
            <ButtonWithLoading
              variant="primary"
              isLoading={isLoading}
              onPress={() => void onSubmit(() => state.close())}
            >
              <Trans>Save and continue</Trans>
            </ButtonWithLoading>
          </ModalButtons>
        </>
      )}
    </Modal>
  );
}

// The side of the switch that matches its state reads as the chosen option.
// Only the color changes, so the switch does not shift when flipped.
function toggleSideStyle(isActive: boolean) {
  return isActive ? undefined : { color: theme.pageTextSubdued };
}
