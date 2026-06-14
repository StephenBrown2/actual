import React, { useCallback, useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button, ButtonWithLoading } from '@actual-app/components/button';
import { SvgAlertTriangle } from '@actual-app/components/icons/v2';
import { Paragraph } from '@actual-app/components/paragraph';
import { SpaceBetween } from '@actual-app/components/space-between';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { Tooltip } from '@actual-app/components/tooltip';
import { View } from '@actual-app/components/view';
import { send } from '@actual-app/core/platform/client/connection';
import {
  parseWallosFile,
  toRecurConfig,
} from '@actual-app/core/server/importers/wallos';
import type { ParsedWallosSubscription } from '@actual-app/core/server/importers/wallos';
import { format as monthUtilFormat } from '@actual-app/core/shared/months';

import { AccountAutocomplete } from '#components/autocomplete/AccountAutocomplete';
import { PayeeAutocomplete } from '#components/autocomplete/PayeeAutocomplete';
import { Modal, ModalCloseButton, ModalHeader } from '#components/common/Modal';
import { Checkbox } from '#components/forms';
import {
  Cell,
  Field,
  Row,
  SelectCell,
  Table,
  TableHeader,
} from '#components/table';
import { useAccounts } from '#hooks/useAccounts';
import { useDateFormat } from '#hooks/useDateFormat';
import { useFormat } from '#hooks/useFormat';
import { useLocale } from '#hooks/useLocale';
import { usePayees } from '#hooks/usePayees';
import {
  SelectedProvider,
  useSelected,
  useSelectedDispatch,
  useSelectedItems,
} from '#hooks/useSelected';
import { useCreatePayeeMutation } from '#payees';
import { getRecurringDescription } from '#util/schedule';

import { ROW_HEIGHT } from './SchedulesTable';

/**
 * Schedule name in Actual from Wallos fields. When `swapNameAndPayee` is false,
 * uses subscription name; when true, uses Notes (legacy mapping).
 */
function wallosScheduleName(
  sub: Pick<ParsedWallosSubscription, 'name' | 'notes'>,
  swapNameAndPayee: boolean,
): string {
  if (swapNameAndPayee) {
    return sub.notes?.trim() || sub.name;
  }
  return sub.name;
}

/**
 * Payee name from Wallos fields. When `swapNameAndPayee` is false, uses Notes
 * when set else subscription name; when true, uses subscription name (legacy).
 */
function wallosPayeeName(
  sub: Pick<ParsedWallosSubscription, 'name' | 'notes'>,
  swapNameAndPayee: boolean,
): string {
  if (swapNameAndPayee) {
    return sub.name;
  }
  const trimmedNotes = sub.notes?.trim();
  return trimmedNotes ? trimmedNotes : sub.name;
}

/**
 * Represents a Wallos subscription with UI state for import.
 * Extends ParsedWallosSubscription with fields for tracking user selections
 * and duplicate detection status during the import workflow.
 */
type ImportedSubscription = ParsedWallosSubscription & {
  /** Name to use for the created schedule */
  scheduleName: string;
  /** The account selected for this subscription */
  selectedAccountId: string | null;
  /** The payee selected/matched for this subscription */
  selectedPayeeId: string | null;
  /** Name to use for creating a new payee if no existing payee matched */
  matchedPayeeName: string | null;
  /** Whether a potential duplicate schedule exists */
  isDuplicate: boolean;
};

type PayeeLike = { id: string; name: string };
type AccountLike = { id: string; name: string };

function buildImportedSubscription(
  sub: ParsedWallosSubscription,
  swapNameAndPayee: boolean,
  payees: PayeeLike[],
  accounts: AccountLike[],
  isDuplicate: boolean,
): ImportedSubscription {
  const scheduleName = wallosScheduleName(sub, swapNameAndPayee);
  const payeeName = wallosPayeeName(sub, swapNameAndPayee);
  const matchedPayee = payees.find(
    p => p.name.toLowerCase().trim() === payeeName.toLowerCase().trim(),
  );
  const matchedAccount = accounts.find(a => {
    const accountName = a.name.toLowerCase().trim();
    const paymentMethod = sub.paymentMethod?.toLowerCase().trim();
    return paymentMethod ? accountName === paymentMethod : false;
  });

  return {
    ...sub,
    scheduleName,
    selectedAccountId: matchedAccount?.id ?? null,
    selectedPayeeId: matchedPayee?.id ?? null,
    matchedPayeeName: matchedPayee ? null : payeeName,
    isDuplicate,
  };
}

/**
 * Props for the ImportWallosTable component.
 */
type ImportWallosTableProps = {
  /** Array of subscriptions to display */
  subscriptions: ImportedSubscription[];
  /** When true, Notes maps to schedule name and subscription name to payee */
  swapNameAndPayee: boolean;
  /** Callback when account selection changes */
  onAccountChange: (subId: string, accountId: string | null) => void;
  /** Callback when payee selection changes */
  onPayeeChange: (
    subId: string,
    payeeId: string | null,
    payeeName: string | null,
  ) => void;
};

/**
 * Table component for displaying and selecting Wallos subscriptions to import.
 *
 * Features:
 * - Multi-select with checkboxes
 * - Per-row account and payee selection
 * - Duplicate warning indicators
 * - Recurrence and amount display
 * - Highlights rows missing required account selection
 */
function ImportWallosTable({
  subscriptions,
  swapNameAndPayee,
  onAccountChange,
  onPayeeChange,
}: ImportWallosTableProps) {
  const { t } = useTranslation();
  const selectedItems = useSelectedItems();
  const dispatchSelected = useSelectedDispatch();
  const dateFormat = useDateFormat() || 'MM/dd/yyyy';
  const locale = useLocale();
  const format = useFormat();

  function renderItem({ item }: { item: ImportedSubscription }) {
    const selected = selectedItems.has(item.id);
    const recurDescription = getRecurringDescription(
      toRecurConfig(item),
      dateFormat,
      locale,
    );

    return (
      <Row
        height={ROW_HEIGHT}
        inset={15}
        onClick={e => {
          dispatchSelected({
            type: 'select',
            id: item.id,
            isRangeSelect: e.shiftKey,
          });
        }}
        style={{
          borderColor: selected ? theme.tableBorderSelected : theme.tableBorder,
          cursor: 'pointer',
          color: selected
            ? theme.tableRowBackgroundHighlightText
            : theme.tableText,
          backgroundColor: selected
            ? theme.tableRowBackgroundHighlight
            : theme.tableBackground,
          ':hover': {
            backgroundColor: theme.tableRowBackgroundHover,
            color: theme.tableText,
          },
        }}
      >
        <SelectCell
          exposed
          focused={false}
          selected={selected}
          onSelect={e => {
            dispatchSelected({
              type: 'select',
              id: item.id,
              isRangeSelect: e.shiftKey,
            });
          }}
        />
        <Field
          width={150}
          title={[
            swapNameAndPayee
              ? item.name && `Subscription (payee): ${item.name}`
              : item.name && `Subscription: ${item.name}`,
            swapNameAndPayee
              ? item.notes?.trim() && `Notes (schedule): ${item.notes.trim()}`
              : item.notes?.trim() && `Notes (payee): ${item.notes.trim()}`,
            item.paymentMethod && `Payment Method: ${item.paymentMethod}`,
          ]
            .filter(Boolean)
            .join('\n')}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            {selected && item.isDuplicate && (
              <Tooltip content={t('Potential duplicate schedule')}>
                <SvgAlertTriangle
                  style={{
                    width: 16,
                    height: 16,
                    color: theme.warningText,
                    flexShrink: 0,
                  }}
                />
              </Tooltip>
            )}
            <Text style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {item.scheduleName}
            </Text>
          </View>
        </Field>
        <Cell
          width={150}
          style={{ padding: '5px' }}
          name="payee"
          plain
          onClick={e => e.stopPropagation()}
        >
          <PayeeAutocomplete
            value={item.selectedPayeeId}
            clearOnBlur
            showMakeTransfer={false}
            inputProps={{
              placeholder: wallosPayeeName(item, swapNameAndPayee),
            }}
            onSelect={(payeeId: string) =>
              onPayeeChange(item.id, payeeId, null)
            }
          />
        </Cell>
        <Cell
          width={150}
          style={{
            padding: '5px',
            border:
              selected && !item.selectedAccountId
                ? `1px solid ${theme.warningBorder}`
                : '',
            borderRadius: 4,
          }}
          name="account"
          plain
          onClick={e => e.stopPropagation()}
        >
          <AccountAutocomplete
            value={item.selectedAccountId}
            includeClosedAccounts={false}
            onSelect={(accountId: string) =>
              onAccountChange(item.id, accountId)
            }
          />
        </Cell>
        <Field width="auto" title={recurDescription} style={{ flex: 1 }}>
          {recurDescription}
        </Field>
        <Field width={90}>
          {monthUtilFormat(item.nextPaymentDate, dateFormat)}
        </Field>
        <Cell
          width={80}
          plain
          style={{
            textAlign: 'right',
            padding: '0 5px',
            ...styles.tnum,
          }}
          name="amount"
        >
          <Text
            style={{
              color: item.amount > 0 ? theme.noticeTextLight : theme.tableText,
              ...styles.smallText,
            }}
          >
            {format(Math.abs(item.amount), 'financial')}
          </Text>
        </Cell>
      </Row>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <TableHeader height={ROW_HEIGHT} inset={15}>
        <SelectCell
          exposed
          focused={false}
          selected={selectedItems.size > 0}
          onSelect={e =>
            dispatchSelected({ type: 'select-all', isRangeSelect: e.shiftKey })
          }
        />
        <Field width={150}>
          <Trans>Name</Trans>
        </Field>
        <Field width={150}>
          <Trans>Payee</Trans>
        </Field>
        <Field width={150}>
          <Trans>Account</Trans>
        </Field>
        <Field width="auto" style={{ flex: 1 }}>
          <Trans>When</Trans>
        </Field>
        <Field width={90}>
          <Trans>Next</Trans>
        </Field>
        <Field width={80} style={{ textAlign: 'right' }}>
          <Trans>Amount</Trans>
        </Field>
      </TableHeader>
      <Table
        rowHeight={ROW_HEIGHT}
        style={{
          flex: 1,
          backgroundColor: 'transparent',
        }}
        items={subscriptions}
        isSelected={id => selectedItems.has(String(id))}
        renderItem={renderItem}
        renderEmpty={t('No subscriptions found')}
      />
    </View>
  );
}

/**
 * Modal component for importing subscriptions from Wallos as scheduled transactions.
 *
 * Workflow:
 * 1. User selects Wallos JSON export file
 * 2. File is parsed and checked for duplicates
 * 3. Accounts are auto-matched by Payment Method field
 * 4. Schedule names and payees follow the chosen mapping (optionally swapped)
 * 5. Payees matched or marked for creation from that mapping
 * 6. User reviews and selects subscriptions to import
 * 7. If new payees are needed, shows confirmation step
 * 8. Creates payees and schedules
 *
 * Features:
 * - JSON file import with validation
 * - Automatic account matching via Payment Method
 * - Payee matching and auto-creation
 * - Duplicate detection with warnings
 * - Two-step flow: selection → payee confirmation (if needed) → import
 * - Error handling and user feedback
 *
 * @example
 * // Triggered from schedules page via:
 * // pushModal('import-wallos')
 */
export function ImportWallosModal() {
  const { t } = useTranslation();
  const createPayeeMutation = useCreatePayeeMutation();
  const { data: payees = [] } = usePayees();
  const { data: accounts = [] } = useAccounts();

  const [subscriptions, setSubscriptions] = useState<ImportedSubscription[]>(
    [],
  );
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPayeeConfirm, setShowPayeeConfirm] = useState(false);
  const [showInactiveSubscriptions, setShowInactiveSubscriptions] =
    useState(false);
  const [swapNameAndPayee, setSwapNameAndPayee] = useState(false);

  const displayedSubscriptions = useMemo(
    () =>
      showInactiveSubscriptions
        ? subscriptions
        : subscriptions.filter(subscription => subscription.isActive),
    [subscriptions, showInactiveSubscriptions],
  );

  const selectedInst = useSelected<ImportedSubscription>(
    'wallos-import',
    displayedSubscriptions,
    [],
  );

  // Find payees that need to be created
  const payeesToCreate = useMemo(() => {
    const selected = subscriptions.filter(s => selectedInst.items.has(s.id));
    const newPayees = new Set<string>();

    for (const sub of selected) {
      if (sub.matchedPayeeName && !sub.selectedPayeeId) {
        newPayees.add(sub.matchedPayeeName);
      }
    }

    return Array.from(newPayees);
  }, [subscriptions, selectedInst.items]);

  // Check if all selected subscriptions have accounts assigned
  const allSelectedHaveAccounts = useMemo(() => {
    const selected = subscriptions.filter(s => selectedInst.items.has(s.id));
    return selected.every(s => s.selectedAccountId !== null);
  }, [subscriptions, selectedInst.items]);

  const handleFileSelect = useCallback(async () => {
    try {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';

      input.onchange = async e => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;

        try {
          const content = await file.text();
          const parsed = parseWallosFile(content);

          // Check for duplicates (by schedule name for current mapping)
          const duplicateCheck = await send(
            'schedule/check-wallos-duplicates',
            parsed.map(s => ({
              id: s.id,
              name: wallosScheduleName(s, swapNameAndPayee),
              amount: s.amount,
            })),
          );

          const duplicateMap = new Map(
            duplicateCheck.map(d => [d.subscriptionId, d.isDuplicate]),
          );

          const imported: ImportedSubscription[] = parsed.map(sub =>
            buildImportedSubscription(
              sub,
              swapNameAndPayee,
              payees,
              accounts,
              duplicateMap.get(sub.id) || false,
            ),
          );

          // Sort by next payment date ascending (soonest first)
          imported.sort(
            (a, b) =>
              new Date(a.nextPaymentDate).getTime() -
              new Date(b.nextPaymentDate).getTime(),
          );

          setSubscriptions(imported);
          setError(null);
        } catch (err) {
          setError(
            err instanceof Error ? err.message : t('Failed to parse file'),
          );
        }
      };

      input.click();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Failed to parse file'));
    }
  }, [payees, accounts, swapNameAndPayee, t]);

  const handleSwapNameAndPayeeChange = useCallback(
    (checked: boolean) => {
      setSwapNameAndPayee(checked);
      setSubscriptions(prev => {
        if (prev.length === 0) return prev;
        const updated = prev.map(sub =>
          buildImportedSubscription(sub, checked, payees, accounts, false),
        );
        void send(
          'schedule/check-wallos-duplicates',
          updated.map(s => ({
            id: s.id,
            name: s.scheduleName,
            amount: s.amount,
          })),
        ).then(duplicateCheck => {
          const duplicateMap = new Map(
            duplicateCheck.map(d => [d.subscriptionId, d.isDuplicate]),
          );
          setSubscriptions(current =>
            current.map(s => ({
              ...s,
              isDuplicate: duplicateMap.get(s.id) || false,
            })),
          );
        });
        return updated;
      });
    },
    [payees, accounts],
  );

  const handleAccountChange = useCallback(
    (subId: string, accountId: string | null) => {
      setSubscriptions(prev =>
        prev.map(s =>
          s.id === subId ? { ...s, selectedAccountId: accountId } : s,
        ),
      );
    },
    [],
  );

  const handlePayeeChange = useCallback(
    (subId: string, payeeId: string | null, payeeName: string | null) => {
      setSubscriptions(prev =>
        prev.map(s =>
          s.id === subId
            ? {
                ...s,
                selectedPayeeId: payeeId,
                matchedPayeeName: payeeId
                  ? null
                  : payeeName || wallosPayeeName(s, swapNameAndPayee),
              }
            : s,
        ),
      );
    },
    [swapNameAndPayee],
  );

  const handleImport = useCallback(async (): Promise<boolean> => {
    // If there are payees to create, show confirmation first
    if (payeesToCreate.length > 0 && !showPayeeConfirm) {
      setShowPayeeConfirm(true);
      return false;
    }

    setImporting(true);
    setShowPayeeConfirm(false);

    try {
      const selected = subscriptions.filter(s => selectedInst.items.has(s.id));

      // Create new payees first
      const payeeIdMap = new Map<string, string>();
      for (const name of payeesToCreate) {
        const result = await createPayeeMutation.mutateAsync({ name });
        payeeIdMap.set(name, result);
      }

      // Build import items, filtering out any with missing required fields
      const importItems = selected
        .map(sub => {
          const accountId = sub.selectedAccountId;
          if (!accountId) {
            console.warn(
              `Skipping subscription "${sub.name}": missing account`,
            );
            return null;
          }

          let payeeId = sub.selectedPayeeId;
          if (!payeeId && sub.matchedPayeeName) {
            payeeId = payeeIdMap.get(sub.matchedPayeeName) ?? null;
          }
          if (!payeeId) {
            console.warn(`Skipping subscription "${sub.name}": missing payee`);
            return null;
          }

          return {
            name: sub.scheduleName,
            amount: sub.amount,
            accountId,
            payeeId,
            date: toRecurConfig(sub),
          };
        })
        .filter(
          (
            item,
          ): item is {
            name: string;
            amount: number;
            accountId: string;
            payeeId: string;
            date: ReturnType<typeof toRecurConfig>;
          } => item !== null,
        );

      const result = await send('schedule/import-wallos', importItems);

      if (result.errors.length > 0) {
        setError(
          t('Some schedules failed to import: {{errors}}', {
            errors: result.errors.map(e => e.name).join(', '),
          }),
        );
        return false;
      }
      return true;
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('Failed to import schedules'),
      );
      return false;
    } finally {
      setImporting(false);
    }
  }, [
    subscriptions,
    selectedInst.items,
    payeesToCreate,
    showPayeeConfirm,
    createPayeeMutation,
    t,
  ]);

  const handlePayeeConfirmCancel = useCallback(() => {
    setShowPayeeConfirm(false);
  }, []);

  return (
    <Modal
      name="import-wallos"
      containerProps={{
        style: showPayeeConfirm ? { width: 450 } : { width: 900, height: 650 },
      }}
    >
      {({ state: { close } }: { state: { close: () => void } }) =>
        showPayeeConfirm ? (
          // Payee confirmation view
          <>
            <ModalHeader
              title={t('Create New Payees')}
              rightContent={
                <ModalCloseButton onPress={handlePayeeConfirmCancel} />
              }
            />
            <Paragraph>
              <Trans>The following payees will be created:</Trans>
            </Paragraph>
            <View
              style={{
                maxHeight: 200,
                overflow: 'auto',
                marginBottom: 15,
                padding: '10px 15px',
                backgroundColor: theme.tableBackground,
                borderRadius: 4,
              }}
            >
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                {payeesToCreate.map(name => (
                  <li key={name}>
                    <Text
                      style={{ fontWeight: 600, color: theme.noticeTextDark }}
                    >
                      {name}
                    </Text>
                  </li>
                ))}
              </ul>
            </View>
            <SpaceBetween
              style={{
                paddingTop: 10,
                justifyContent: 'flex-end',
              }}
            >
              <Button onPress={handlePayeeConfirmCancel}>
                <Trans>Cancel</Trans>
              </Button>
              <ButtonWithLoading
                variant="primary"
                isLoading={importing}
                onPress={async () => {
                  const success = await handleImport();
                  if (success) {
                    close();
                  }
                }}
              >
                <Trans>Create and Import</Trans>
              </ButtonWithLoading>
            </SpaceBetween>
          </>
        ) : (
          // Main import view
          <>
            <ModalHeader
              title={t('Import from Wallos')}
              rightContent={<ModalCloseButton onPress={close} />}
            />

            {subscriptions.length === 0 ? (
              <View
                style={{
                  flex: 1,
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
              >
                <View
                  style={{
                    alignSelf: 'center',
                    width: '100%',
                    maxWidth: 450,
                    marginBottom: 20,
                    alignItems: 'center',
                  }}
                >
                  <Paragraph
                    style={{
                      marginBottom: 12,
                      textAlign: 'center',
                      width: '100%',
                    }}
                  >
                    <Trans>Import subscription data from Wallos.</Trans>
                  </Paragraph>
                  <View
                    style={{
                      display: 'flex',
                      justifyContent: 'center',
                      marginBottom: 12,
                      width: '100%',
                    }}
                  >
                    <ul
                      style={{
                        display: 'inline-block',
                        margin: 0,
                        paddingLeft: 20,
                        textAlign: 'left',
                      }}
                    >
                      <li style={{ marginBottom: 6 }}>
                        <Trans>
                          Payment method → Actual account name (auto-matched)
                        </Trans>
                      </li>
                      <li style={{ marginBottom: 6 }}>
                        <Trans>
                          Subscription name → Schedule name in Actual
                        </Trans>
                      </li>
                      <li>
                        <Trans>
                          Notes → Payee when it differs from the schedule name
                          (optional)
                        </Trans>
                      </li>
                    </ul>
                  </View>
                  <Paragraph style={{ textAlign: 'center', width: '100%' }}>
                    <Trans>
                      To export JSON:
                      <br />
                      Profile → Account → Export Subscriptions → "Export as
                      JSON".
                    </Trans>
                  </Paragraph>
                </View>
                <Button variant="primary" onPress={handleFileSelect}>
                  <Trans>Select Wallos Export File</Trans>
                </Button>
                {error && (
                  <Text style={{ color: theme.errorText, marginTop: 15 }}>
                    {error}
                  </Text>
                )}
              </View>
            ) : (
              <>
                <Paragraph>
                  <Trans>
                    Select the subscriptions you want to import as schedules.
                    Each subscription needs an account assigned. Accounts are
                    automatically matched by Payment Method if it matches an
                    account name. By default, schedule names use the Wallos
                    subscription name and payees use Notes when set, otherwise
                    the subscription name. Enable Swap Name and Payee to use
                    Notes for schedule names and the subscription name for
                    payees instead. New payees are created automatically if not
                    selected.
                  </Trans>
                </Paragraph>

                <View
                  style={{
                    flexDirection: 'row',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    columnGap: 24,
                    rowGap: 8,
                    marginTop: 8,
                    marginBottom: 12,
                  }}
                >
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <Checkbox
                      checked={showInactiveSubscriptions}
                      onChange={event =>
                        setShowInactiveSubscriptions(event.target.checked)
                      }
                    />
                    <Text>
                      <Trans>Show inactive/disabled subscriptions</Trans>
                    </Text>
                  </label>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <Checkbox
                      checked={swapNameAndPayee}
                      onChange={event =>
                        handleSwapNameAndPayeeChange(event.target.checked)
                      }
                    />
                    <Text>
                      <Trans>Swap Name and Payee</Trans>
                    </Text>
                  </label>
                </View>

                <SelectedProvider instance={selectedInst}>
                  <ImportWallosTable
                    subscriptions={displayedSubscriptions}
                    swapNameAndPayee={swapNameAndPayee}
                    onAccountChange={handleAccountChange}
                    onPayeeChange={handlePayeeChange}
                  />
                </SelectedProvider>

                {!allSelectedHaveAccounts && selectedInst.items.size > 0 && (
                  <Text
                    style={{
                      color: theme.warningText,
                      marginTop: 10,
                    }}
                  >
                    <Trans>
                      All selected subscriptions must have an account assigned
                    </Trans>
                  </Text>
                )}

                {error && (
                  <Text style={{ color: theme.errorText, marginTop: 10 }}>
                    {error}
                  </Text>
                )}

                <SpaceBetween
                  style={{
                    paddingTop: 20,
                    paddingBottom: 0,
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <Button onPress={handleFileSelect}>
                    <Trans>Select Different File</Trans>
                  </Button>
                  <ButtonWithLoading
                    variant="primary"
                    isLoading={importing}
                    isDisabled={
                      selectedInst.items.size === 0 || !allSelectedHaveAccounts
                    }
                    onPress={async () => {
                      const success = await handleImport();
                      if (success) {
                        close();
                      }
                    }}
                  >
                    <Trans>Import Selected</Trans>
                  </ButtonWithLoading>
                </SpaceBetween>
              </>
            )}
          </>
        )
      }
    </Modal>
  );
}
