import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { useResponsive } from '@actual-app/components/hooks/useResponsive';
import { Input } from '@actual-app/components/input';
import { SpaceBetween } from '@actual-app/components/space-between';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { spacing } from '@actual-app/components/tokens';
import { Tooltip } from '@actual-app/components/tooltip';
import { View } from '@actual-app/components/view';
import type { LinkAccountResult } from '@actual-app/core/server/accounts/app';
import {
  isReviewedCurrency,
  reviewedAmountEncoding,
} from '@actual-app/core/shared/amount-encoding';
import { rescaleDecimalAmount } from '@actual-app/core/shared/amount-rescale';
import { currentDay, subDays } from '@actual-app/core/shared/months';
import type {
  AccountEntity,
  SyncServerAkahuAccount,
  SyncServerEnableBankingAccount,
  SyncServerGoCardlessAccount,
  SyncServerPlaidAccount,
  SyncServerPluggyAiAccount,
  SyncServerSimpleFinAccount,
} from '@actual-app/core/types/models';
import { format as formatDate, parseISO } from 'date-fns';

import {
  useLinkAccountAkahuMutation,
  useLinkAccountEnableBankingMutation,
  useLinkAccountMutation,
  useLinkAccountPlaidMutation,
  useLinkAccountPluggyAiMutation,
  useLinkAccountSimpleFinMutation,
  useUnlinkAccountMutation,
} from '#accounts';
import { Autocomplete } from '#components/autocomplete/Autocomplete';
import type { AutocompleteItem } from '#components/autocomplete/Autocomplete';
import { Modal, ModalCloseButton, ModalHeader } from '#components/common/Modal';
import { FinancialText } from '#components/FinancialText';
import { Checkbox } from '#components/forms';
import { LabeledCheckbox } from '#components/forms/LabeledCheckbox';
import { MissingRateForm } from '#components/modals/ImportTransactionsModal/MissingRateForm';
import { PrivacyFilter } from '#components/PrivacyFilter';
import { Cell, Field, Row, Table, TableHeader } from '#components/table';
import { AmountInput } from '#components/util/AmountInput';
import {
  AccountCurrencyFormat,
  CurrencyFormatProvider,
} from '#hooks/currencyFormatContext';
import { useAccounts } from '#hooks/useAccounts';
import { useAmountPrecision } from '#hooks/useAmountPrecision';
import { useDateFormat } from '#hooks/useDateFormat';
import { useFormat } from '#hooks/useFormat';
import { useMulticurrencyAvailable } from '#hooks/useMulticurrencyAvailable';
import { useSyncedPref } from '#hooks/useSyncedPref';
import { closeModal, replaceModal } from '#modals/modalsSlice';
import { addNotification } from '#notifications/notificationsSlice';
import { transactions } from '#queries';
import { liveQuery } from '#queries/liveQuery';
import { useDispatch } from '#redux';
import { reencodeAmount } from '#util/account-encoding';

function useAddBudgetAccountOptions() {
  const { t } = useTranslation();

  const addOnBudgetAccountOption = {
    id: 'new-on',
    name: t('Create new account'),
  };
  const addOffBudgetAccountOption = {
    id: 'new-off',
    name: t('Create new account (off budget)'),
  };

  return { addOnBudgetAccountOption, addOffBudgetAccountOption };
}

type AddBudgetAccountOption = {
  id: string;
  name: string;
};

type LinkFailure =
  | Exclude<LinkAccountResult, { type: 'ok' }>
  | { type: 'link-error' };

export type LinkCurrencyContext = {
  multicurrency: boolean;
  budgetCurrency: string;
};

const LEGACY_LINK_CURRENCY: LinkCurrencyContext = {
  multicurrency: false,
  budgetCurrency: '',
};

/**
 * The currency of a new account linked to a provider account: null for the
 * budget currency, undefined when no account can hold it.
 */
export function newAccountCurrency(
  providerCurrency: string | null | undefined,
  { multicurrency, budgetCurrency }: LinkCurrencyContext,
): string | null | undefined {
  if (!multicurrency || !providerCurrency) return null;
  if (providerCurrency === budgetCurrency) return null;
  return isReviewedCurrency(providerCurrency) ? providerCurrency : undefined;
}

/** Whether a local account may receive this provider account's amounts. */
export function isLinkCompatible(
  account: Pick<AccountEntity, 'currency'>,
  providerCurrency: string | null | undefined,
  { multicurrency, budgetCurrency }: LinkCurrencyContext,
): boolean {
  // An unknown provider currency, or a budget without multicurrency, links
  // only to accounts in the budget currency.
  if (!multicurrency || !providerCurrency) return !account.currency;
  return (account.currency ?? budgetCurrency) === providerCurrency;
}

export function getSelectableAccountOptions({
  localAccounts,
  selectedLocalAccountIds,
  chosenAccount,
  syncSource,
  addOnBudgetAccountOption,
  addOffBudgetAccountOption,
  providerCurrency,
  currencyContext = LEGACY_LINK_CURRENCY,
}: {
  localAccounts: AccountEntity[];
  selectedLocalAccountIds: ReadonlySet<string>;
  chosenAccount: { id: string; name: string } | undefined;
  syncSource: NonNullable<AccountEntity['account_sync_source']>;
  addOnBudgetAccountOption: AddBudgetAccountOption;
  addOffBudgetAccountOption: AddBudgetAccountOption;
  providerCurrency?: string | null;
  currencyContext?: LinkCurrencyContext;
}): AutocompleteItem[] {
  const options: AutocompleteItem[] = localAccounts.filter(account => {
    const isCurrentSelection = account.id === chosenAccount?.id;

    // Keep the current row's selection visible. Otherwise, offer only accounts
    // in the provider account's currency that are unselected and either
    // manual or linked to this provider.
    if (!isLinkCompatible(account, providerCurrency, currencyContext)) {
      return false;
    }
    return (
      isCurrentSelection ||
      (!selectedLocalAccountIds.has(account.id) &&
        (account.account_sync_source == null ||
          account.account_sync_source === syncSource))
    );
  });

  if (newAccountCurrency(providerCurrency, currencyContext) !== undefined) {
    options.push(addOnBudgetAccountOption, addOffBudgetAccountOption);
  }
  return options;
}

/** Recorded format of a currency an account is or will be kept in. */
function currencyFormat(currencyCode: string | null | undefined) {
  return currencyCode && isReviewedCurrency(currencyCode)
    ? {
        currencyCode,
        precision: reviewedAmountEncoding(currencyCode).precision,
      }
    : null;
}

function FormatIn({
  format,
  children,
}: {
  format: { currencyCode: string; precision: number } | null;
  children: ReactNode;
}) {
  return format ? (
    <CurrencyFormatProvider {...format}>{children}</CurrencyFormatProvider>
  ) : (
    children
  );
}

/**
 * Helper to determine if the chosen account option represents creating a new account.
 */
function isNewAccountOption(
  chosenAccountId: string | undefined,
  addOnBudgetOptionId: string,
  addOffBudgetOptionId: string,
): boolean {
  return (
    chosenAccountId === addOnBudgetOptionId ||
    chosenAccountId === addOffBudgetOptionId
  );
}

/**
 * Computes which local accounts should be pre-linked to which external
 * accounts when the modal first opens. When `upgradingAccountId` is set and
 * there's exactly one external account that doesn't already match a known
 * local account, it's unambiguous which row it belongs to, so it's
 * preselected. If there's more than one unmatched external account, guessing
 * would risk claiming the wrong row (and hiding the account from every other
 * row's picker), so it's left for the user to pick manually.
 */
export function computeInitialLinkState(
  localAccounts: AccountEntity[],
  externalAccounts: ExternalAccount[],
  upgradingAccountId: string | undefined,
  currencyContext: LinkCurrencyContext = LEGACY_LINK_CURRENCY,
): {
  initialDraftLinkAccounts: Map<string, 'linking' | 'unlinking'>;
  initiallyChosenAccounts: Record<string, string>;
} {
  const externalAccountIds = new Set(externalAccounts.map(a => a.account_id));
  const initialDraftLinkAccounts = new Map<string, 'linking' | 'unlinking'>();
  for (const acc of localAccounts) {
    if (acc.account_id && externalAccountIds.has(acc.account_id)) {
      initialDraftLinkAccounts.set(acc.account_id, 'linking');
    }
  }

  const initiallyChosenAccounts: Record<string, string> = Object.fromEntries(
    localAccounts
      .filter(acc => acc.account_id)
      .map(acc => [acc.account_id, acc.id]),
  );

  const unmatchedExternalAccounts = externalAccounts.filter(
    account => initiallyChosenAccounts[account.account_id] == null,
  );

  const upgradingAccount = localAccounts.find(
    acc => acc.id === upgradingAccountId,
  );
  if (
    upgradingAccount &&
    unmatchedExternalAccounts.length === 1 &&
    !Object.values(initiallyChosenAccounts).includes(upgradingAccount.id) &&
    // Never preselect an account in another currency.
    (!currencyContext.multicurrency ||
      isLinkCompatible(
        upgradingAccount,
        unmatchedExternalAccounts[0].currency,
        currencyContext,
      ))
  ) {
    initiallyChosenAccounts[unmatchedExternalAccounts[0].account_id] =
      upgradingAccount.id;
    initialDraftLinkAccounts.set(
      unmatchedExternalAccounts[0].account_id,
      'linking',
    );
  }

  return { initialDraftLinkAccounts, initiallyChosenAccounts };
}

export type SelectLinkedAccountsModalProps =
  | {
      requisitionId: string;
      externalAccounts: SyncServerGoCardlessAccount[];
      syncSource: 'goCardless';
      upgradingAccountId?: string;
    }
  | {
      requisitionId?: undefined;
      externalAccounts: SyncServerSimpleFinAccount[];
      syncSource: 'simpleFin';
      upgradingAccountId?: string;
    }
  | {
      requisitionId?: undefined;
      externalAccounts: SyncServerPluggyAiAccount[];
      syncSource: 'pluggyai';
      upgradingAccountId?: string;
    }
  | {
      requisitionId?: undefined;
      externalAccounts: SyncServerEnableBankingAccount[];
      syncSource: 'enableBanking';
      upgradingAccountId?: string;
    }
  | {
      requisitionId?: undefined;
      externalAccounts: SyncServerAkahuAccount[];
      syncSource: 'akahu';
      upgradingAccountId?: string;
    }
  | {
      requisitionId?: undefined;
      externalAccounts: SyncServerPlaidAccount[];
      syncSource: 'plaid';
      upgradingAccountId?: string;
    };

/** A Plaid account as linked once its quantity offer is accepted. */
function withQuantitySync(
  account: SyncServerPlaidAccount,
): SyncServerPlaidAccount {
  return account.quantityOffer
    ? {
        ...account,
        currency: account.quantityOffer.currency,
        balance: account.quantityOffer.quantity,
        balanceOnly: false,
        syncQuantity: true,
      }
    : account;
}

export function SelectLinkedAccountsModal({
  requisitionId,
  externalAccounts,
  syncSource,
  upgradingAccountId,
}: SelectLinkedAccountsModalProps) {
  // Plaid accounts whose quantity offer the user accepted.
  const [quantityOptIns, setQuantityOptIns] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const propsWithSortedExternalAccounts =
    useMemo<SelectLinkedAccountsModalProps>(() => {
      const toSort = externalAccounts ? [...externalAccounts] : [];
      toSort.sort(
        (a, b) =>
          getInstitutionName(a)?.localeCompare(getInstitutionName(b)) ||
          a.name.localeCompare(b.name),
      );
      switch (syncSource) {
        case 'simpleFin':
          return {
            syncSource: 'simpleFin',
            externalAccounts: toSort as SyncServerSimpleFinAccount[],
            upgradingAccountId,
          };
        case 'pluggyai':
          return {
            syncSource: 'pluggyai',
            externalAccounts: toSort as SyncServerPluggyAiAccount[],
            upgradingAccountId,
          };
        case 'akahu':
          return {
            syncSource: 'akahu',
            externalAccounts: toSort as SyncServerAkahuAccount[],
            upgradingAccountId,
          };
        case 'plaid':
          return {
            syncSource: 'plaid',
            externalAccounts: (toSort as SyncServerPlaidAccount[]).map(
              account =>
                quantityOptIns.has(account.account_id)
                  ? withQuantitySync(account)
                  : account,
            ),
            upgradingAccountId,
          };
        case 'goCardless':
          return {
            syncSource: 'goCardless',
            requisitionId: requisitionId!,
            externalAccounts: toSort as SyncServerGoCardlessAccount[],
            upgradingAccountId,
          };
        case 'enableBanking':
          return {
            syncSource: 'enableBanking',
            externalAccounts: toSort as SyncServerEnableBankingAccount[],
            upgradingAccountId,
          };
        default:
          throw new Error(`Unrecognized sync source: ${String(syncSource)}`);
      }
    }, [
      externalAccounts,
      syncSource,
      requisitionId,
      upgradingAccountId,
      quantityOptIns,
    ]);

  const { t } = useTranslation();
  const { isNarrowWidth } = useResponsive();
  const dispatch = useDispatch();
  const { data: allAccounts = [] } = useAccounts();
  const localAccounts = allAccounts.filter(a => a.closed === 0);
  const multicurrency = useMulticurrencyAvailable();
  const [budgetCurrency] = useSyncedPref('defaultCurrencyCode');
  const budgetPrecision = useAmountPrecision();
  const currencyContext: LinkCurrencyContext = {
    multicurrency,
    budgetCurrency: budgetCurrency || '',
  };
  const { initialDraftLinkAccounts, initiallyChosenAccounts } =
    computeInitialLinkState(
      localAccounts,
      propsWithSortedExternalAccounts.externalAccounts,
      upgradingAccountId,
      currencyContext,
    );

  const [draftLinkAccounts, setDraftLinkAccounts] = useState<
    Map<string, 'linking' | 'unlinking'>
  >(initialDraftLinkAccounts);
  const [chosenAccounts, setChosenAccounts] = useState<Record<string, string>>(
    initiallyChosenAccounts,
  );
  const [customStartingDates, setCustomStartingDates] = useState<
    Record<string, CustomStartingSettings>
  >({});
  const { addOnBudgetAccountOption, addOffBudgetAccountOption } =
    useAddBudgetAccountOptions();

  // Foreign links that wrote nothing, by provider account, kept for retry.
  const [linkFailures, setLinkFailures] = useState<Record<string, LinkFailure>>(
    {},
  );
  const [isLinking, setIsLinking] = useState(false);
  // Requests already made in this dialog: provider account to the destination
  // it was linked to, and unlinked local accounts. A retry applies only what
  // is new or still failing.
  const [completedLinks, setCompletedLinks] = useState<Record<string, string>>(
    {},
  );
  const [unlinkedIds, setUnlinkedIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  // Local accounts that existed when a new-account link was sent, by provider
  // account, so the account that link created can be found afterwards.
  const [newLinkBaselines, setNewLinkBaselines] = useState<
    Record<string, ReadonlySet<string>>
  >({});

  const linkAccount = useLinkAccountMutation();
  const unlinkAccount = useUnlinkAccountMutation();
  const linkAccountSimpleFin = useLinkAccountSimpleFinMutation();
  const linkAccountPluggyAi = useLinkAccountPluggyAiMutation();
  const linkAccountAkahu = useLinkAccountAkahuMutation();
  const linkAccountPlaid = useLinkAccountPlaidMutation();
  const linkAccountEnableBanking = useLinkAccountEnableBankingMutation();

  /** A chosen destination's format: null for the budget currency. */
  function destinationFormat(
    externalAccount: ExternalAccount,
    chosenLocalAccountId: string | undefined,
  ) {
    if (
      isNewAccountOption(
        chosenLocalAccountId,
        addOnBudgetAccountOption.id,
        addOffBudgetAccountOption.id,
      )
    ) {
      return currencyFormat(
        newAccountCurrency(externalAccount.currency, currencyContext),
      );
    }
    const account = localAccounts.find(acc => acc.id === chosenLocalAccountId);
    return account?.currency && account.currency_precision != null
      ? {
          currencyCode: account.currency,
          precision: account.currency_precision,
        }
      : null;
  }

  /** The row's starting settings in its current destination's encoding. */
  function startingSettingsFor(externalAccount: ExternalAccount) {
    return reencodeStartingSettings(
      getCustomStartingDate(externalAccount.account_id),
      destinationFormat(
        externalAccount,
        chosenAccounts[externalAccount.account_id],
      )?.precision ?? budgetPrecision,
    );
  }

  function linkExternalAccount(
    externalAccountIndex: number,
    chosenLocalAccountId: string,
    startingDate: string | undefined,
    startingBalance: number | undefined,
  ): Promise<LinkAccountResult> {
    const params = {
      upgradingId: isNewAccountOption(
        chosenLocalAccountId,
        addOnBudgetAccountOption.id,
        addOffBudgetAccountOption.id,
      )
        ? undefined
        : chosenLocalAccountId,
      offBudget: chosenLocalAccountId === addOffBudgetAccountOption.id,
      startingDate,
      startingBalance,
    };
    const props = propsWithSortedExternalAccounts;
    switch (props.syncSource) {
      case 'simpleFin':
        return linkAccountSimpleFin.mutateAsync({
          externalAccount: props.externalAccounts[externalAccountIndex],
          ...params,
        });
      case 'pluggyai':
        return linkAccountPluggyAi.mutateAsync({
          externalAccount: props.externalAccounts[externalAccountIndex],
          ...params,
        });
      case 'akahu':
        return linkAccountAkahu.mutateAsync({
          externalAccount: props.externalAccounts[externalAccountIndex],
          ...params,
        });
      case 'plaid':
        return linkAccountPlaid.mutateAsync({
          externalAccount: props.externalAccounts[externalAccountIndex],
          ...params,
        });
      case 'enableBanking':
        return linkAccountEnableBanking.mutateAsync({
          externalAccount: props.externalAccounts[externalAccountIndex],
          ...params,
        });
      default:
        return linkAccount.mutateAsync({
          requisitionId: props.requisitionId,
          account: props.externalAccounts[externalAccountIndex],
          ...params,
        });
    }
  }

  async function onNext() {
    const completed = { ...completedLinks };
    const baselines = { ...newLinkBaselines };
    // A new-account link that created its account (even if its first sync
    // failed) now targets that account, so a retry never creates another.
    const chosen = { ...chosenAccounts };
    for (const [externalId, localId] of Object.entries(chosen)) {
      const baseline = baselines[externalId];
      const created =
        baseline &&
        isNewAccountOption(
          localId,
          addOnBudgetAccountOption.id,
          addOffBudgetAccountOption.id,
        ) &&
        allAccounts.find(
          acc => acc.account_id === externalId && !baseline.has(acc.id),
        );
      if (created) {
        chosen[externalId] = created.id;
        if (completed[externalId] === localId) {
          completed[externalId] = created.id;
        }
      }
    }
    setChosenAccounts(chosen);
    const chosenLocalAccountIds = Object.values(chosen);

    // Unlink accounts that were previously linked, but the user
    // chose to remove the bank-sync
    const toUnlink = localAccounts
      .filter(acc => acc.account_id && !unlinkedIds.has(acc.id))
      .filter(acc => !chosenLocalAccountIds.includes(acc.id));
    toUnlink.forEach(acc => unlinkAccount.mutate({ id: acc.id }));
    const unlinked = new Set([...unlinkedIds, ...toUnlink.map(acc => acc.id)]);
    // A link to an account unlinked since is no longer made.
    for (const [externalId, localId] of Object.entries(completed)) {
      if (unlinked.has(localId)) {
        delete completed[externalId];
      }
    }

    // Foreign links write nothing until they can complete, and Plaid links
    // wait for the bank's history, so their results are awaited; links
    // already made to the same destination are skipped.
    const foreignLinks: Array<[string, string, Promise<LinkAccountResult>]> =
      [];
    Object.entries(chosen).forEach(
      ([chosenExternalAccountId, chosenLocalAccountId]) => {
        if (completed[chosenExternalAccountId] === chosenLocalAccountId) {
          return;
        }
        const externalAccountIndex =
          propsWithSortedExternalAccounts.externalAccounts.findIndex(
            account => account.account_id === chosenExternalAccountId,
          );

        // Skip linking accounts that were previously linked with
        // a different bank.
        if (externalAccountIndex === -1) {
          return;
        }

        const { startingDate, startingBalance } = resolveStartingSettings(
          chosenExternalAccountId in customStartingDates
            ? startingSettingsFor(
                propsWithSortedExternalAccounts.externalAccounts[
                  externalAccountIndex
                ],
              )
            : undefined,
        );
        if (
          isNewAccountOption(
            chosenLocalAccountId,
            addOnBudgetAccountOption.id,
            addOffBudgetAccountOption.id,
          )
        ) {
          baselines[chosenExternalAccountId] = new Set(
            allAccounts.map(acc => acc.id),
          );
        }
        const result = linkExternalAccount(
          externalAccountIndex,
          chosenLocalAccountId,
          startingDate,
          startingBalance,
        );
        // Linking again makes an unlinked account linked.
        unlinked.delete(chosenLocalAccountId);
        const isForeign =
          destinationFormat(
            propsWithSortedExternalAccounts.externalAccounts[
              externalAccountIndex
            ],
            chosenLocalAccountId,
          ) !== null;
        if (isForeign || syncSource === 'plaid') {
          foreignLinks.push([
            chosenExternalAccountId,
            chosenLocalAccountId,
            result,
          ]);
        } else {
          completed[chosenExternalAccountId] = chosenLocalAccountId;
          // Errors are reported by the mutation; a failed link is no longer
          // treated as made, so a retry sends it again.
          result.catch(() => {
            if (completed[chosenExternalAccountId] === chosenLocalAccountId) {
              delete completed[chosenExternalAccountId];
            }
            setCompletedLinks(previous => {
              if (previous[chosenExternalAccountId] !== chosenLocalAccountId) {
                return previous;
              }
              const { [chosenExternalAccountId]: _failed, ...rest } = previous;
              return rest;
            });
          });
        }
      },
    );

    setIsLinking(true);
    const failures: Record<string, LinkFailure> = {};
    let currencyMismatches = 0;
    for (const [externalAccountId, localAccountId, result] of foreignLinks) {
      try {
        const outcome = await result;
        if (outcome.type === 'ok') {
          completed[externalAccountId] = localAccountId;
          currencyMismatches += outcome.currencyMismatches;
        } else {
          failures[externalAccountId] = outcome;
        }
      } catch {
        // The mutation reports the error; the dialog stays open for a retry.
        failures[externalAccountId] = { type: 'link-error' };
      }
    }
    setIsLinking(false);
    setCompletedLinks(completed);
    setUnlinkedIds(unlinked);
    setNewLinkBaselines(baselines);
    if (currencyMismatches > 0) {
      dispatch(
        addNotification({
          notification: {
            type: 'warning',
            message: t(
              '{{count}} downloaded transactions were in another currency and were skipped.',
              { count: currencyMismatches },
            ),
          },
        }),
      );
    }

    if (Object.keys(failures).length > 0) {
      setLinkFailures(failures);
      return;
    }
    dispatch(closeModal());
  }

  // Only reserve accounts chosen by visible rows; stale provider links should
  // stay selectable so users can relink them after reconnecting.
  const currentExternalAccountIds = new Set(
    propsWithSortedExternalAccounts.externalAccounts.map(
      account => account.account_id,
    ),
  );

  const selectedLocalAccountIds = new Set(
    Object.entries(chosenAccounts)
      .filter(([externalAccountId]) =>
        currentExternalAccountIds.has(externalAccountId),
      )
      .map(([, localAccountId]) => localAccountId),
  );

  function onSetLinkedAccount(
    externalAccount: { account_id: string },
    localAccountId: string | null | undefined,
  ) {
    setChosenAccounts(accounts => {
      const updatedAccounts = { ...accounts };

      if (localAccountId) {
        updatedAccounts[externalAccount.account_id] = localAccountId;
        setDraftLinkAccounts(prev =>
          new Map(prev).set(externalAccount.account_id, 'linking'),
        );
      } else {
        delete updatedAccounts[externalAccount.account_id];
        setDraftLinkAccounts(prev =>
          new Map(prev).set(externalAccount.account_id, 'unlinking'),
        );
      }

      return updatedAccounts;
    });
  }

  const getChosenAccount = (accountId: string) => {
    const chosenId = chosenAccounts[accountId];
    if (!chosenId) return undefined;

    if (chosenId === addOnBudgetAccountOption.id) {
      return addOnBudgetAccountOption;
    }
    if (chosenId === addOffBudgetAccountOption.id) {
      return addOffBudgetAccountOption;
    }

    return localAccounts.find(acc => acc.id === chosenId);
  };

  const defaultStartingSettings = getDefaultStartingSettings(syncSource);

  const getCustomStartingDate = (accountId: string) => {
    if (customStartingDates[accountId]) {
      return customStartingDates[accountId];
    }
    return defaultStartingSettings;
  };

  const setCustomStartingDate = (
    accountId: string,
    settings: CustomStartingSettings,
  ) => {
    setCustomStartingDates(prev => ({
      ...prev,
      [accountId]: settings,
    }));
  };

  // A changed currency may leave the chosen account in another currency.
  function onSetQuantitySync(account: SyncServerPlaidAccount, accept: boolean) {
    setQuantityOptIns(previous => {
      const next = new Set(previous);
      if (accept) {
        next.add(account.account_id);
      } else {
        next.delete(account.account_id);
      }
      return next;
    });
    const chosen = localAccounts.find(
      acc => acc.id === chosenAccounts[account.account_id],
    );
    const currency = accept
      ? account.quantityOffer?.currency
      : account.currency;
    if (chosen && !isLinkCompatible(chosen, currency, currencyContext)) {
      setChosenAccounts(({ [account.account_id]: _dropped, ...rest }) => rest);
    }
  }

  function onAddInvestments({ itemId, institution }: SyncServerPlaidAccount) {
    dispatch(
      replaceModal({
        modal: {
          name: 'plaid-link',
          options: {
            upgradingAccountId,
            update: {
              itemId,
              investmentsFor: {
                itemId,
                institutionId: null,
                institutionName: institution ?? null,
                products: ['investments'],
              },
            },
          },
        },
      }),
    );
  }

  const failedAccounts =
    propsWithSortedExternalAccounts.externalAccounts.filter(
      account => account.account_id in linkFailures,
    );

  const label = useMemo(() => {
    const s = new Set(draftLinkAccounts.values());
    if (s.has('linking') && s.has('unlinking')) {
      return t('Link and unlink accounts');
    } else if (s.has('linking')) {
      return t('Link accounts');
    } else if (s.has('unlinking')) {
      return t('Unlink accounts');
    }

    return t('Link or unlink accounts');
  }, [draftLinkAccounts, t]);

  // Desktop shows quantity offers in their own column when any account has one.
  const showQuantityColumn =
    syncSource === 'plaid' &&
    propsWithSortedExternalAccounts.externalAccounts.some(account =>
      plaidQuantityOption(account as SyncServerPlaidAccount, currencyContext),
    );

  return (
    <Modal
      name="select-linked-accounts"
      containerProps={{
        style: isNarrowWidth
          ? {
              width: '100vw',
              maxWidth: '100vw',
              height: '100vh',
              margin: 0,
              display: 'flex',
              flexDirection: 'column',
            }
          : { width: 1000 },
      }}
    >
      {({ state }) => (
        <View
          style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
        >
          <ModalHeader
            title={t('Link Accounts')}
            rightContent={<ModalCloseButton onPress={() => state.close()} />}
          />

          <View
            style={{
              padding: isNarrowWidth ? '0 16px' : '0 20px',
              flexShrink: 0,
            }}
          >
            <Text style={{ marginBottom: 20 }}>
              <Trans>
                We found the following accounts. Select which ones you want to
                add:
              </Trans>
            </Text>
          </View>

          {isNarrowWidth ? (
            <View
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '0 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              {propsWithSortedExternalAccounts.externalAccounts.map(account => (
                <AccountCard
                  key={account.account_id}
                  externalAccount={account}
                  chosenAccount={getChosenAccount(account.account_id)}
                  localAccounts={localAccounts}
                  selectedLocalAccountIds={selectedLocalAccountIds}
                  syncSource={syncSource}
                  onSetLinkedAccount={onSetLinkedAccount}
                  customStartingDate={startingSettingsFor(account)}
                  onSetCustomStartingDate={setCustomStartingDate}
                  currencyContext={currencyContext}
                  destinationFormat={destinationFormat(
                    account,
                    chosenAccounts[account.account_id],
                  )}
                  needsStartingBalance={
                    linkFailures[account.account_id]?.type ===
                    'balance-unavailable'
                  }
                  plaidOption={
                    syncSource === 'plaid' && (
                      <PlaidQuantityOption
                        account={account as SyncServerPlaidAccount}
                        currencyContext={currencyContext}
                        optIns={quantityOptIns}
                        onSetQuantitySync={onSetQuantitySync}
                        onAddInvestments={onAddInvestments}
                      />
                    )
                  }
                />
              ))}
            </View>
          ) : (
            <View
              style={{ ...styles.tableContainer, height: 300, flex: 'unset' }}
            >
              <TableHeader>
                <Cell value={t('Institution to Sync')} width={150} />
                <Cell value={t('Bank Account')} width={120} />
                <Cell value={t('Balance')} width={120} />
                <Cell value={t('Account in Actual')} width="flex" />
                <Cell value={t('Starting Date')} width={120} />
                <Cell value={t('Starting Balance')} width={120} />
                {showQuantityColumn && (
                  <Cell value={t('Quantity')} width={80} textAlign="center" />
                )}
                <Cell value={t('Actions')} width={150} textAlign="center" />
              </TableHeader>

              <Table<ExternalAccount & { id: string }>
                items={propsWithSortedExternalAccounts.externalAccounts.map(
                  acc => ({ ...acc, id: acc.account_id }),
                )}
                style={{ backgroundColor: theme.tableHeaderBackground }}
                renderItem={({ item }) => {
                  const chosenAccount = getChosenAccount(item.account_id);
                  // Only show starting options for new accounts being created,
                  // or when a link needs an explicit starting balance.
                  const shouldShowStartingOptions =
                    isNewAccountOption(
                      chosenAccount?.id,
                      addOnBudgetAccountOption.id,
                      addOffBudgetAccountOption.id,
                    ) ||
                    linkFailures[item.account_id]?.type ===
                      'balance-unavailable';

                  return (
                    <TableRow
                      key={item.id}
                      externalAccount={item}
                      chosenAccount={chosenAccount}
                      localAccounts={localAccounts}
                      selectedLocalAccountIds={selectedLocalAccountIds}
                      syncSource={syncSource}
                      onSetLinkedAccount={onSetLinkedAccount}
                      customStartingDate={startingSettingsFor(item)}
                      onSetCustomStartingDate={setCustomStartingDate}
                      showStartingOptions={shouldShowStartingOptions}
                      needsStartingBalance={
                        linkFailures[item.account_id]?.type ===
                        'balance-unavailable'
                      }
                      currencyContext={currencyContext}
                      destinationFormat={destinationFormat(
                        item,
                        chosenAccounts[item.account_id],
                      )}
                      plaidOption={
                        showQuantityColumn ? (
                          <PlaidQuantityOption
                            account={item as SyncServerPlaidAccount}
                            inTable
                            currencyContext={currencyContext}
                            optIns={quantityOptIns}
                            onSetQuantitySync={onSetQuantitySync}
                            onAddInvestments={onAddInvestments}
                          />
                        ) : undefined
                      }
                    />
                  );
                }}
              />
            </View>
          )}

          {failedAccounts.length > 0 && (
            <View
              style={{
                padding: isNarrowWidth ? '12px 16px 0' : '12px 0 0',
                flexShrink: 0,
              }}
            >
              {failedAccounts.map(account => {
                const failure = linkFailures[account.account_id];
                return (
                  <View key={account.account_id}>
                    <Text style={{ fontWeight: 600, marginBottom: 4 }}>
                      {account.name}
                    </Text>
                    {failure.type === 'rate-unavailable' ? (
                      <MissingRateForm
                        dates={failure.dates}
                        currencyCode={failure.currency}
                        onSaved={() => void onNext()}
                      />
                    ) : failure.type === 'link-error' ? (
                      <Text
                        style={{ color: theme.errorText, marginBottom: 15 }}
                      >
                        <Trans>This account could not be linked.</Trans>
                      </Text>
                    ) : failure.type === 'history-timeout' ? (
                      <Text
                        style={{ color: theme.errorText, marginBottom: 15 }}
                      >
                        <Trans>
                          The bank has not sent this account&apos;s transaction
                          history yet. Try again in a few minutes.
                        </Trans>
                      </Text>
                    ) : (
                      <Text
                        style={{ color: theme.warningText, marginBottom: 15 }}
                      >
                        <Trans>
                          The bank did not report a balance in this
                          account&apos;s currency. Enter the balance on the
                          starting date, then try again.
                        </Trans>
                      </Text>
                    )}
                  </View>
                );
              })}
            </View>
          )}

          {isLinking && syncSource === 'plaid' && (
            <Text
              style={{
                padding: isNarrowWidth ? '12px 16px 0' : '12px 0 0',
                flexShrink: 0,
              }}
            >
              <Trans>
                Waiting for the bank&apos;s transaction history. This can take a
                few minutes.
              </Trans>
            </Text>
          )}

          <View
            style={{
              flexDirection: 'row',
              justifyContent: isNarrowWidth ? 'center' : 'flex-end',
              ...(isNarrowWidth
                ? {
                    padding: '16px',
                    flexShrink: 0,
                    borderTop: `1px solid ${theme.tableBorder}`,
                  }
                : { marginTop: 10 }),
            }}
          >
            <Button
              variant="primary"
              onPress={() => void onNext()}
              isDisabled={draftLinkAccounts.size === 0 || isLinking}
              style={
                isNarrowWidth
                  ? {
                      width: '100%',
                      height: '44px',
                      fontSize: '1em',
                    }
                  : undefined
              }
            >
              {failedAccounts.length > 0 ? t('Try again') : label}
            </Button>
          </View>
        </View>
      )}
    </Modal>
  );
}

/**
 * Opt-ins for Plaid investment accounts: quantity sync for an account whose
 * only security is a currency the budget can hold as a foreign account, or
 * investment access for an Item that lacks it.
 */
/** What a Plaid account can offer: quantity sync, or the access it needs. */
function plaidQuantityOption(
  account: SyncServerPlaidAccount,
  currencyContext: LinkCurrencyContext,
): 'offer' | 'investments' | null {
  if (
    account.quantityOffer &&
    typeof newAccountCurrency(
      account.quantityOffer.currency,
      currencyContext,
    ) === 'string'
  ) {
    return 'offer';
  }
  return currencyContext.multicurrency && account.needsInvestments
    ? 'investments'
    : null;
}

type PlaidQuantityHandlers = {
  currencyContext: LinkCurrencyContext;
  optIns: ReadonlySet<string>;
  onSetQuantitySync: (account: SyncServerPlaidAccount, accept: boolean) => void;
  onAddInvestments: (account: SyncServerPlaidAccount) => void;
};

/**
 * One account's quantity offer, in its card on phones or in the Quantity
 * column of the desktop table.
 */
function PlaidQuantityOption({
  account,
  inTable = false,
  currencyContext,
  optIns,
  onSetQuantitySync,
  onAddInvestments,
}: PlaidQuantityHandlers & {
  account: SyncServerPlaidAccount;
  inTable?: boolean;
}) {
  const { t } = useTranslation();
  const kind = plaidQuantityOption(account, currencyContext);
  if (kind === 'offer') {
    const id = `plaid-quantity-${account.account_id}`;
    const label = t(
      'Sync as its quantity of {{currency}}, instead of only its balance',
      { currency: account.quantityOffer?.currency },
    );
    const checked = optIns.has(account.account_id);
    const onChange = ({ currentTarget }: { currentTarget: HTMLInputElement }) =>
      onSetQuantitySync(account, currentTarget.checked);
    return inTable ? (
      <Tooltip content={label}>
        <Checkbox
          id={id}
          aria-label={label}
          checked={checked}
          onChange={onChange}
          style={{ marginRight: 0 }}
        />
      </Tooltip>
    ) : (
      <LabeledCheckbox id={id} checked={checked} onChange={onChange}>
        {label}
      </LabeledCheckbox>
    );
  }
  if (kind === 'investments') {
    const why = t(
      'This account may hold a currency whose quantity can be synced. Checking needs investment access from the bank.',
    );
    return inTable ? (
      <Tooltip content={why}>
        <Button onPress={() => onAddInvestments(account)}>
          <Trans>Allow</Trans>
        </Button>
      </Tooltip>
    ) : (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Text>{why}</Text>
        <Button onPress={() => onAddInvestments(account)}>
          <Trans>Allow investment access</Trans>
        </Button>
      </View>
    );
  }
  return null;
}

type ExternalAccount =
  | SyncServerGoCardlessAccount
  | SyncServerSimpleFinAccount
  | SyncServerPluggyAiAccount
  | SyncServerAkahuAccount
  | SyncServerEnableBankingAccount
  | SyncServerPlaidAccount;

type StartingBalanceInfo = {
  date: string;
  amount: number;
};

// The starting balance the user typed into the link modal. `amount` stays
// undefined until they actually edit it, so that only touching the date does
// not send a starting balance of 0 to the server - which would override the
// balance the bank reports.
type CustomStartingSettings = {
  date: string;
  amount?: number;
  /** Precision the amount was entered at. */
  precision?: number;
};

/**
 * Expresses a typed starting balance at another destination precision, or
 * drops it when the value cannot be represented exactly there.
 */
export function reencodeStartingSettings(
  settings: CustomStartingSettings,
  precision: number,
): CustomStartingSettings {
  if (
    settings.amount == null ||
    settings.precision == null ||
    settings.precision === precision
  ) {
    return settings;
  }
  const amount = reencodeAmount(settings.amount, settings.precision, precision);
  return amount === null
    ? { date: settings.date }
    : { ...settings, amount, precision };
}

/**
 * The settings a row starts with. The balance is deliberately absent: the
 * server derives the opening balance from the bank unless one is supplied, so
 * defaulting it to 0 here would silently override the real balance for anyone
 * who only adjusts the date.
 */
export function getDefaultStartingSettings(
  syncSource?: SelectLinkedAccountsModalProps['syncSource'],
): CustomStartingSettings {
  // Plaid loads the last 30 days first; other providers default to 90 days.
  // Both match the server's defaults (inclusive of today).
  return { date: subDays(currentDay(), syncSource === 'plaid' ? 29 : 89) };
}

/**
 * Turn the row's draft settings into the arguments sent when linking. Anything
 * the user did not fill in stays undefined so the server keeps its own default.
 */
export function resolveStartingSettings(
  settings: CustomStartingSettings | undefined,
): { startingDate?: string; startingBalance?: number } {
  return {
    startingDate:
      settings?.date && settings.date.trim() !== '' ? settings.date : undefined,
    startingBalance: settings?.amount != null ? settings.amount : undefined,
  };
}

type SharedAccountRowProps = {
  currencyContext: LinkCurrencyContext;
  /** Format of the chosen destination; null for the budget currency. */
  destinationFormat: { currencyCode: string; precision: number } | null;
  externalAccount: ExternalAccount;
  chosenAccount: { id: string; name: string } | undefined;
  localAccounts: AccountEntity[];
  selectedLocalAccountIds: ReadonlySet<string>;
  syncSource: SelectLinkedAccountsModalProps['syncSource'];
  onSetLinkedAccount: (
    externalAccount: ExternalAccount,
    localAccountId: string | null | undefined,
  ) => void;
};

type TableRowProps = SharedAccountRowProps & {
  customStartingDate: CustomStartingSettings;
  onSetCustomStartingDate: (
    accountId: string,
    settings: CustomStartingSettings,
  ) => void;
  showStartingOptions: boolean;
  /** The Quantity cell's contents; undefined leaves the column out. */
  plaidOption?: ReactNode;
  /** The link needs an explicit starting balance. */
  needsStartingBalance: boolean;
};

// Providers report balances in major units, as decimal strings or numbers. A
// balance the display precision cannot hold shows as unknown instead of
// breaking the list.
export function previewBalance(
  balance: ExternalAccount['balance'],
  precision: number,
): number | null {
  if (balance == null) return null;
  try {
    return rescaleDecimalAmount(
      typeof balance === 'string' ? balance : balance.toFixed(precision),
      precision,
    );
  } catch {
    return null;
  }
}

/** An account's starting balance in its own units (native when foreign). */
function useStartingBalanceInfo(
  account: Pick<AccountEntity, 'id' | 'currency'> | undefined,
) {
  const [info, setInfo] = useState<StartingBalanceInfo | null>(null);
  const accountId = account?.id;
  const isForeign = !!account?.currency;

  useEffect(() => {
    if (!accountId) {
      setInfo(null);
      return;
    }

    const query = transactions(accountId)
      .filter({ starting_balance_flag: true })
      .select(['date', 'amount', 'transaction_amount'])
      .limit(1);

    const live = liveQuery<
      StartingBalanceInfo & { transaction_amount: number | null }
    >(query, {
      onData: data => {
        const row = data?.[0];
        setInfo(
          row
            ? {
                date: row.date,
                amount: isForeign ? (row.transaction_amount ?? 0) : row.amount,
              }
            : null,
        );
      },
      onError: () => {
        setInfo(null);
      },
    });

    return () => {
      live?.unsubscribe();
    };
  }, [accountId, isForeign]);

  return info;
}

function TableRow({
  externalAccount,
  chosenAccount,
  localAccounts,
  selectedLocalAccountIds,
  syncSource,
  onSetLinkedAccount,
  customStartingDate,
  onSetCustomStartingDate,
  showStartingOptions,
  needsStartingBalance,
  currencyContext,
  destinationFormat,
  plaidOption,
}: TableRowProps) {
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const { addOnBudgetAccountOption, addOffBudgetAccountOption } =
    useAddBudgetAccountOptions();
  const dateFormat = useDateFormat() || 'MM/dd/yyyy';
  const chosenLocalAccount = localAccounts.find(
    acc => acc.id === chosenAccount?.id,
  );
  const startingBalanceInfo = useStartingBalanceInfo(
    showStartingOptions ? undefined : chosenLocalAccount,
  );

  const availableAccountOptions = getSelectableAccountOptions({
    localAccounts,
    selectedLocalAccountIds,
    chosenAccount,
    syncSource,
    addOnBudgetAccountOption,
    addOffBudgetAccountOption,
    providerCurrency: externalAccount.currency,
    currencyContext,
  });

  return (
    <Row style={{ backgroundColor: theme.tableBackground }}>
      {/* Institution to Sync */}
      <Field width={150}>
        <Tooltip content={getInstitutionName(externalAccount)}>
          <View
            style={{
              textOverflow: 'ellipsis',
              overflow: 'hidden',
              display: 'block',
            }}
          >
            {getInstitutionName(externalAccount)}
          </View>
        </Tooltip>
      </Field>
      {/* Bank Account */}
      <Field width={120}>
        <Tooltip content={externalAccount.name}>
          <View
            style={{
              textOverflow: 'ellipsis',
              overflow: 'hidden',
              display: 'block',
            }}
          >
            {externalAccount.name}
          </View>
        </Tooltip>
      </Field>
      {/* Balance */}
      <Field width={120} style={{ textAlign: 'right' }}>
        <PrivacyFilter>
          <ProviderBalance
            externalAccount={externalAccount}
            currencyContext={currencyContext}
          />
        </PrivacyFilter>
      </Field>
      {/* Account in Actual */}
      <Field
        width="flex"
        truncate={focusedField !== 'account'}
        onClick={() => setFocusedField('account')}
      >
        {focusedField === 'account' ? (
          <Autocomplete
            focused
            strict
            highlightFirst
            suggestions={availableAccountOptions}
            onSelect={value => {
              onSetLinkedAccount(externalAccount, value);
            }}
            inputProps={{
              onBlur: () => setFocusedField(null),
            }}
            value={chosenAccount?.id}
          />
        ) : (
          chosenAccount?.name
        )}
      </Field>
      {showStartingOptions ? (
        <FormatIn format={destinationFormat}>
          <StartingOptionsFields
            accountId={externalAccount.account_id}
            externalBalance={externalAccount.balance}
            customStartingDate={customStartingDate}
            onSetCustomStartingDate={onSetCustomStartingDate}
            needsStartingBalance={needsStartingBalance}
            layout="inline"
          />
        </FormatIn>
      ) : (
        <>
          {/* Starting Date */}
          <Field width={120} truncate={false} style={{ textAlign: 'right' }}>
            {startingBalanceInfo ? (
              <Text
                style={{
                  color: theme.pageTextSubdued,
                  fontStyle: 'italic',
                }}
              >
                {formatDate(parseISO(startingBalanceInfo.date), dateFormat)}
              </Text>
            ) : null}
          </Field>
          {/* Starting Balance */}
          <Field width={120} truncate={false} style={{ textAlign: 'right' }}>
            {startingBalanceInfo ? (
              <PrivacyFilter>
                <AccountCurrencyFormat account={chosenLocalAccount}>
                  <FormattedAmount
                    amount={startingBalanceInfo.amount}
                    style={{
                      color: theme.pageTextSubdued,
                      fontStyle: 'italic',
                    }}
                  />
                </AccountCurrencyFormat>
              </PrivacyFilter>
            ) : null}
          </Field>
        </>
      )}
      {plaidOption !== undefined && (
        <Field
          width={80}
          truncate={false}
          style={{ alignItems: 'center', justifyContent: 'center' }}
        >
          {plaidOption}
        </Field>
      )}
      {/* Actions */}
      <Field width={150}>
        {chosenAccount ? (
          <Button
            onPress={() => {
              onSetLinkedAccount(externalAccount, null);
            }}
            style={{ float: 'right' }}
          >
            <Trans>Remove bank sync</Trans>
          </Button>
        ) : (
          <Button
            variant="primary"
            onPress={() => {
              setFocusedField('account');
            }}
            style={{ float: 'right' }}
          >
            <Trans>Set up bank sync</Trans>
          </Button>
        )}
      </Field>
    </Row>
  );
}

/** A provider balance, in the provider account's currency when known. */
function ProviderBalance({
  externalAccount,
  currencyContext,
}: {
  externalAccount: ExternalAccount;
  currencyContext: LinkCurrencyContext;
}) {
  const { currency, balance } = externalAccount;
  // A currency no account can hold is shown as reported, not as the budget's.
  if (
    currencyContext.multicurrency &&
    currency &&
    currency !== currencyContext.budgetCurrency &&
    !isReviewedCurrency(currency)
  ) {
    return (
      <FinancialText>
        {balance} {currency}
      </FinancialText>
    );
  }
  return (
    <FormatIn
      format={
        currencyContext.multicurrency
          ? currencyFormat(externalAccount.currency)
          : null
      }
    >
      <ProviderBalanceText balance={externalAccount.balance} />
    </FormatIn>
  );
}

function ProviderBalanceText({
  balance,
}: {
  balance: ExternalAccount['balance'];
}) {
  const format = useFormat();
  const { t } = useTranslation();
  const value = previewBalance(balance, format.precision);
  return value != null ? (
    <FinancialText>{format(value, 'financial')}</FinancialText>
  ) : (
    t('Unknown')
  );
}

function FormattedAmount({
  amount,
  style,
}: {
  amount: number;
  style?: CSSProperties;
}) {
  const format = useFormat();
  return (
    <FinancialText style={style}>{format(amount, 'financial')}</FinancialText>
  );
}

function getInstitutionName(
  externalAccount:
    | SyncServerGoCardlessAccount
    | SyncServerSimpleFinAccount
    | SyncServerPluggyAiAccount
    | SyncServerEnableBankingAccount
    | SyncServerPlaidAccount,
) {
  if (typeof externalAccount?.institution === 'string') {
    return externalAccount?.institution ?? '';
  } else if (typeof externalAccount.institution?.name === 'string') {
    return externalAccount?.institution?.name ?? '';
  }
  return '';
}

type StartingOptionsFieldsProps = {
  accountId: string;
  externalBalance: number | string | null | undefined;
  customStartingDate: CustomStartingSettings;
  onSetCustomStartingDate: (
    accountId: string,
    settings: CustomStartingSettings,
  ) => void;
  /** The bank reported no balance, so the user must type one. */
  needsStartingBalance: boolean;
  layout: 'inline' | 'stacked';
};

function StartingOptionsFields({
  accountId,
  externalBalance,
  customStartingDate,
  onSetCustomStartingDate,
  needsStartingBalance,
  layout,
}: StartingOptionsFieldsProps) {
  const precision = useAmountPrecision();
  const zeroSign =
    externalBalance != null && Number(externalBalance) < 0 ? '-' : '+';

  if (layout === 'inline') {
    return (
      <>
        {/* Starting Date */}
        <Field width={120} truncate={false}>
          <Input
            type="date"
            value={customStartingDate.date}
            onChange={e =>
              onSetCustomStartingDate(accountId, {
                ...customStartingDate,
                date: e.target.value,
              })
            }
            style={{ width: '100%' }}
          />
        </Field>
        {/* Starting Balance */}
        <Field width={120} truncate={false} style={{ textAlign: 'right' }}>
          <StartingBalanceInput
            compact
            needsAmount={needsStartingBalance}
            zeroSign={zeroSign}
            amount={customStartingDate.amount}
            onUpdate={amount =>
              onSetCustomStartingDate(accountId, {
                ...customStartingDate,
                amount,
                precision,
              })
            }
          />
        </Field>
      </>
    );
  }

  return (
    <View
      style={{
        marginTop: 8,
        padding: '12px',
        backgroundColor: theme.tableHeaderBackground,
        borderRadius: 4,
      }}
    >
      <View style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <View>
          <Text
            size="medium"
            style={{
              marginBottom: spacing.xs,
              color: theme.pageTextSubdued,
            }}
          >
            <Trans>Starting date:</Trans>
          </Text>
          <Input
            type="date"
            value={customStartingDate.date}
            onChange={e =>
              onSetCustomStartingDate(accountId, {
                ...customStartingDate,
                date: e.target.value,
              })
            }
            style={{ width: '100%' }}
          />
        </View>
        <View>
          <Text
            size="medium"
            style={{
              marginBottom: spacing.xs,
              color: theme.pageTextSubdued,
            }}
          >
            <Trans>Balance on that date:</Trans>
          </Text>
          <StartingBalanceInput
            compact={false}
            needsAmount={needsStartingBalance}
            zeroSign={zeroSign}
            amount={customStartingDate.amount}
            onUpdate={amount =>
              onSetCustomStartingDate(accountId, {
                ...customStartingDate,
                amount,
                precision,
              })
            }
          />
        </View>
      </View>
    </View>
  );
}

/**
 * Without a typed amount, the server works out the starting balance from the
 * bank's current balance and the imported transactions. The field says so
 * instead of showing 0, and only a typed amount replaces it.
 */
function StartingBalanceInput({
  amount,
  compact,
  needsAmount,
  zeroSign,
  onUpdate,
}: {
  amount: number | undefined;
  /** The narrow table column gets the short label. */
  compact: boolean;
  needsAmount: boolean;
  zeroSign: '-' | '+';
  onUpdate: (amount: number) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [hasTyped, setHasTyped] = useState(false);

  if (amount === undefined && !isEditing && !needsAmount) {
    return (
      <Button
        variant="bare"
        onPress={() => setIsEditing(true)}
        style={{
          width: '100%',
          justifyContent: 'flex-start',
          border: '1px solid ' + theme.formInputBorder,
          color: theme.pageTextSubdued,
          fontStyle: 'italic',
          whiteSpace: 'nowrap',
        }}
      >
        {compact ? <Trans>From bank</Trans> : <Trans>From bank history</Trans>}
      </Button>
    );
  }
  return (
    <AmountInput
      focused={isEditing}
      value={amount ?? 0}
      zeroSign={zeroSign}
      onChangeValue={() => setHasTyped(true)}
      onUpdate={value => {
        setIsEditing(false);
        if (hasTyped) onUpdate(value);
      }}
      style={{ width: '100%' }}
    />
  );
}

type AccountCardProps = SharedAccountRowProps & {
  /** The link needs an explicit starting balance. */
  needsStartingBalance: boolean;
  /** A provider-specific option shown above the card's link button. */
  plaidOption?: ReactNode;
  customStartingDate: CustomStartingSettings;
  onSetCustomStartingDate: (
    accountId: string,
    settings: CustomStartingSettings,
  ) => void;
};

function AccountCard({
  externalAccount,
  chosenAccount,
  localAccounts,
  selectedLocalAccountIds,
  syncSource,
  onSetLinkedAccount,
  customStartingDate,
  onSetCustomStartingDate,
  currencyContext,
  destinationFormat,
  needsStartingBalance,
  plaidOption,
}: AccountCardProps) {
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const { addOnBudgetAccountOption, addOffBudgetAccountOption } =
    useAddBudgetAccountOptions();
  const dateFormat = useDateFormat() || 'MM/dd/yyyy';
  const { t } = useTranslation();

  const availableAccountOptions = getSelectableAccountOptions({
    localAccounts,
    selectedLocalAccountIds,
    chosenAccount,
    syncSource,
    addOnBudgetAccountOption,
    addOffBudgetAccountOption,
    providerCurrency: externalAccount.currency,
    currencyContext,
  });

  // Only show starting date options for new accounts being created, or when
  // a link needs an explicit starting balance.
  const shouldShowStartingOptions =
    isNewAccountOption(
      chosenAccount?.id,
      addOnBudgetAccountOption.id,
      addOffBudgetAccountOption.id,
    ) || needsStartingBalance;
  const chosenLocalAccount = localAccounts.find(
    acc => acc.id === chosenAccount?.id,
  );
  const startingBalanceInfo = useStartingBalanceInfo(
    shouldShowStartingOptions ? undefined : chosenLocalAccount,
  );

  return (
    <SpaceBetween
      direction="vertical"
      gap={10}
      style={{
        backgroundColor: theme.tableBackground,
        borderRadius: 8,
        padding: '12px 16px',
        border: `1px solid ${theme.tableBorder}`,
        minHeight: 'fit-content',
        alignItems: 'stretch',
      }}
    >
      <View
        style={{
          fontWeight: 600,
          fontSize: '1.1em',
          color: theme.pageText,
          wordWrap: 'break-word',
          overflowWrap: 'break-word',
        }}
      >
        {externalAccount.name}
      </View>

      <View
        style={{
          fontSize: '0.9em',
          color: theme.pageTextSubdued,
          wordWrap: 'break-word',
          overflowWrap: 'break-word',
        }}
      >
        {getInstitutionName(externalAccount)}
      </View>

      <View
        style={{
          fontSize: '0.9em',
          color: theme.pageTextSubdued,
        }}
      >
        <Trans>Balance:</Trans>{' '}
        <PrivacyFilter>
          <ProviderBalance
            externalAccount={externalAccount}
            currencyContext={currencyContext}
          />
        </PrivacyFilter>
      </View>

      <SpaceBetween
        direction="horizontal"
        gap={5}
        style={{
          fontSize: '0.9em',
          color: theme.pageTextSubdued,
        }}
      >
        <Text>
          <Trans>Linked to:</Trans>
        </Text>
        {chosenAccount ? (
          <Text style={{ color: theme.noticeTextLight, fontWeight: 500 }}>
            {chosenAccount.name}
          </Text>
        ) : (
          <Text style={{ color: theme.pageTextSubdued }}>
            <Trans>Not linked</Trans>
          </Text>
        )}
      </SpaceBetween>

      {!shouldShowStartingOptions && startingBalanceInfo && (
        <View
          style={{
            fontSize: '0.9em',
            color: theme.pageTextSubdued,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          <View style={{ display: 'flex', flexDirection: 'row', gap: 4 }}>
            <Text style={{ color: theme.pageTextSubdued }}>
              <Trans>Starting date:</Trans>
            </Text>
            <Text
              style={{
                color: theme.pageTextSubdued,
                fontStyle: 'italic',
              }}
            >
              {formatDate(parseISO(startingBalanceInfo.date), dateFormat)}
            </Text>
          </View>
          <View style={{ display: 'flex', flexDirection: 'row', gap: 4 }}>
            <Text style={{ color: theme.pageTextSubdued }}>
              <Trans>Starting balance:</Trans>
            </Text>
            <PrivacyFilter>
              <AccountCurrencyFormat account={chosenLocalAccount}>
                <FormattedAmount
                  amount={startingBalanceInfo.amount}
                  style={{
                    color: theme.pageTextSubdued,
                    fontStyle: 'italic',
                  }}
                />
              </AccountCurrencyFormat>
            </PrivacyFilter>
          </View>
        </View>
      )}

      {focusedField === 'account' && (
        <View style={{ marginBottom: 12 }}>
          <Autocomplete
            focused
            strict
            highlightFirst
            suggestions={availableAccountOptions}
            onSelect={value => {
              onSetLinkedAccount(externalAccount, value);
              setFocusedField(null);
            }}
            inputProps={{
              onBlur: () => setFocusedField(null),
              placeholder: t('Select account...'),
            }}
            value={chosenAccount?.id}
          />
        </View>
      )}

      {shouldShowStartingOptions && (
        <FormatIn format={destinationFormat}>
          <StartingOptionsFields
            accountId={externalAccount.account_id}
            externalBalance={externalAccount.balance}
            customStartingDate={customStartingDate}
            onSetCustomStartingDate={onSetCustomStartingDate}
            needsStartingBalance={needsStartingBalance}
            layout="stacked"
          />
        </FormatIn>
      )}

      {plaidOption}

      {chosenAccount ? (
        <Button
          onPress={() => {
            onSetLinkedAccount(externalAccount, null);
          }}
          style={{
            padding: '8px 16px',
            fontSize: '0.9em',
            width: '100%',
          }}
        >
          <Trans>Remove bank sync</Trans>
        </Button>
      ) : (
        <Button
          variant="primary"
          onPress={() => {
            setFocusedField('account');
          }}
          style={{
            padding: '8px 16px',
            fontSize: '0.9em',
            width: '100%',
          }}
        >
          <Trans>Link account</Trans>
        </Button>
      )}
    </SpaceBetween>
  );
}
