import React, { useCallback, useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button, ButtonWithLoading } from '@actual-app/components/button';
import { SvgAlertTriangle, SvgCheck } from '@actual-app/components/icons/v2';
import { Paragraph } from '@actual-app/components/paragraph';
import { SpaceBetween } from '@actual-app/components/space-between';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { Tooltip } from '@actual-app/components/tooltip';
import { View } from '@actual-app/components/view';
import { sendCatch } from '@actual-app/core/platform/client/connection';
import type { ScheduleTransferPayload } from '@actual-app/core/server/schedules/app';
import { format as monthUtilFormat } from '@actual-app/core/shared/months';
import { q } from '@actual-app/core/shared/query';
import {
  extractScheduleConds,
  getNextDate,
  scheduleIsRecurring,
} from '@actual-app/core/shared/schedules';
import type { ScheduleEntity } from '@actual-app/core/types/models';

import { Modal, ModalCloseButton, ModalHeader } from '#components/common/Modal';
import { Field, Row, SelectCell, Table, TableHeader } from '#components/table';
import { useDateFormat } from '#hooks/useDateFormat';
import { useSchedules } from '#hooks/useSchedules';
import {
  SelectedProvider,
  useSelected,
  useSelectedDispatch,
  useSelectedItems,
} from '#hooks/useSelected';

import { ROW_HEIGHT, ScheduleAmountCell } from './SchedulesTable';

type JsonScheduleRow = {
  id: string;
  index: number;
  name: string | null;
  payee: string | null;
  account: string | null;
  nextDate: string | null;
  amount: ScheduleEntity['_amount'] | null;
  amountOp: ScheduleEntity['_amountOp'] | null;
  isRecurring: boolean;
  isDuplicate: boolean;
};

type TransferSchedule = ScheduleTransferPayload['schedules'][number];

function conditionScalarToDisplay(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (Array.isArray(value)) {
    const parts = value.filter(v => typeof v === 'string') as string[];
    if (parts.length === 0) {
      return null;
    }
    return parts.join(', ');
  }
  return null;
}

function extractPreviewFromTransferItem(
  item: TransferSchedule,
): Pick<
  JsonScheduleRow,
  'payee' | 'account' | 'nextDate' | 'amount' | 'amountOp' | 'isRecurring'
> {
  const conditions = Array.isArray(item.rule?.conditions)
    ? item.rule.conditions
    : [];

  const {
    payee,
    account,
    amount: amountCond,
    date: dateCond,
  } = extractScheduleConds(conditions);

  let nextDate: string | null = null;
  let isRecurring = false;
  if (dateCond) {
    try {
      nextDate = getNextDate(dateCond);
    } catch {
      nextDate = null;
    }
    try {
      isRecurring = scheduleIsRecurring(dateCond);
    } catch {
      isRecurring = false;
    }
  }

  const payeeStr = payee
    ? conditionScalarToDisplay((payee as { value?: unknown }).value)
    : null;
  const accountStr = account
    ? conditionScalarToDisplay((account as { value?: unknown }).value)
    : null;

  let amount: ScheduleEntity['_amount'] | null = null;
  let amountOp: ScheduleEntity['_amountOp'] | null = null;
  if (
    amountCond &&
    typeof amountCond === 'object' &&
    amountCond != null &&
    'op' in amountCond &&
    'value' in amountCond
  ) {
    const op = (amountCond as { op: string }).op;
    const val = (amountCond as { value: unknown }).value;
    if (op === 'is' && typeof val === 'number') {
      amount = val;
      amountOp = 'is';
    } else if (op === 'isapprox' && typeof val === 'number') {
      amount = val;
      amountOp = 'isapprox';
    } else if (
      op === 'isbetween' &&
      val &&
      typeof val === 'object' &&
      val != null &&
      'num1' in val &&
      'num2' in val
    ) {
      amount = val as { num1: number; num2: number };
      amountOp = 'isbetween';
    }
  }

  return {
    payee: payeeStr,
    account: accountStr,
    nextDate,
    amount,
    amountOp,
    isRecurring,
  };
}

function normalizeScheduleName(name: string | null | undefined): string | null {
  if (typeof name !== 'string') {
    return null;
  }
  const trimmed = name.trim().toLowerCase();
  return trimmed || null;
}

/** First `Name (k)` whose normalized form is not in `reservedNormalizedNames`. */
function withDuplicateNameSuffix(
  trimmedName: string,
  reservedNormalizedNames: Set<string>,
): string {
  let k = 1;
  while (k < 10000) {
    const candidate = `${trimmedName} (${k})`;
    const norm = normalizeScheduleName(candidate);
    if (norm && !reservedNormalizedNames.has(norm)) {
      return candidate;
    }
    k += 1;
  }
  return `${trimmedName} (${k})`;
}

/** Resolved names for import only (budget + cross-selected conflicts). */
function buildImportNameOverrides(
  selectedRows: JsonScheduleRow[],
  existingNormalizedNames: Set<string>,
): Record<number, string> {
  const reserved = new Set(existingNormalizedNames);
  const out: Record<number, string> = {};
  const sorted = [...selectedRows].sort((a, b) => a.index - b.index);

  for (const row of sorted) {
    const trimmed = typeof row.name === 'string' ? row.name.trim() : '';
    if (!trimmed) {
      continue;
    }
    const norm = normalizeScheduleName(trimmed);
    if (!norm) {
      continue;
    }

    if (reserved.has(norm)) {
      const resolved = withDuplicateNameSuffix(trimmed, reserved);
      out[row.index] = resolved;
      const resolvedNorm = normalizeScheduleName(resolved);
      if (resolvedNorm) {
        reserved.add(resolvedNorm);
      }
    } else {
      reserved.add(norm);
    }
  }

  return out;
}

function buildRows(
  payload: ScheduleTransferPayload,
  existingNames: Set<string>,
): JsonScheduleRow[] {
  return payload.schedules.map((item, index) => {
    const name = typeof item.name === 'string' ? item.name : null;
    const trimmed = typeof item.name === 'string' ? item.name.trim() : '';
    const normalized = normalizeScheduleName(trimmed || null);
    const isDuplicate = normalized != null && existingNames.has(normalized);

    const preview = extractPreviewFromTransferItem(item);
    return {
      id: `json-schedule-row-${index}`,
      index,
      name,
      ...preview,
      isDuplicate,
    };
  });
}

function JsonImportTable({
  rows,
  dateFormat,
}: {
  rows: JsonScheduleRow[];
  dateFormat: string;
}) {
  const { t } = useTranslation();
  const dispatchSelected = useSelectedDispatch();
  const selectedItems = useSelectedItems();

  const renderItem = useCallback(
    ({ item }: { item: JsonScheduleRow }) => {
      const selected = selectedItems.has(item.id);
      const nameLabel = item.name?.trim() || t('(unnamed schedule)');

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
            borderColor: selected
              ? theme.tableBorderSelected
              : theme.tableBorder,
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
            width="flex"
            name="name"
            truncate={false}
            style={{ minWidth: 0 }}
          >
            <View
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
            >
              {selected && item.isDuplicate && (
                <Tooltip
                  content={t(
                    'This name matches an existing schedule. If imported, the schedule will be renamed "{{nameLabel}} (N)".',
                    { nameLabel },
                  )}
                >
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
              <Text
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {nameLabel}
              </Text>
            </View>
          </Field>
          <Field
            width="flex"
            name="payee"
            truncate={false}
            style={{ minWidth: 0 }}
          >
            <Text
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                ...(item.payee == null
                  ? { color: theme.buttonNormalDisabledText }
                  : null),
              }}
            >
              {item.payee ?? t('None')}
            </Text>
          </Field>
          <Field
            width="flex"
            name="account"
            truncate={false}
            style={{ minWidth: 0 }}
          >
            <Text
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                ...(item.account == null
                  ? { color: theme.buttonNormalDisabledText }
                  : null),
              }}
            >
              {item.account ?? t('None')}
            </Text>
          </Field>
          <Field width={110} name="date" truncate={false}>
            {item.nextDate ? monthUtilFormat(item.nextDate, dateFormat) : null}
          </Field>
          {item.amount != null && item.amountOp != null ? (
            <ScheduleAmountCell amount={item.amount} op={item.amountOp} />
          ) : (
            <Field
              width={100}
              truncate={false}
              style={{ textAlign: 'right' }}
            />
          )}
          <Field width={80} style={{ textAlign: 'center' }}>
            {item.isRecurring && <SvgCheck style={{ width: 13, height: 13 }} />}
          </Field>
        </Row>
      );
    },
    [dateFormat, dispatchSelected, selectedItems, t],
  );

  return (
    <View style={{ flex: 1, minHeight: 200 }}>
      <TableHeader height={ROW_HEIGHT} inset={15}>
        <SelectCell
          exposed
          focused={false}
          selected={selectedItems.size > 0}
          onSelect={e =>
            dispatchSelected({
              type: 'select-all',
              isRangeSelect: e.shiftKey,
            })
          }
        />
        <Field width="flex">
          <Trans>Name</Trans>
        </Field>
        <Field width="flex">
          <Trans>Payee</Trans>
        </Field>
        <Field width="flex">
          <Trans>Account</Trans>
        </Field>
        <Field width={110}>
          <Trans>Next date</Trans>
        </Field>
        <Field width={100} style={{ textAlign: 'right' }}>
          <Trans>Amount</Trans>
        </Field>
        <Field width={80} style={{ textAlign: 'center' }}>
          <Trans>Recurring</Trans>
        </Field>
      </TableHeader>
      <Table
        rowHeight={ROW_HEIGHT}
        style={{
          flex: 1,
          backgroundColor: 'transparent',
        }}
        items={rows}
        isSelected={id => selectedItems.has(String(id))}
        renderItem={renderItem}
        renderEmpty={t('No schedules in file')}
      />
    </View>
  );
}

export function ImportSchedulesJsonModal() {
  const { t } = useTranslation();
  const dateFormat = useDateFormat() || 'MM/dd/yyyy';
  const [filepath, setFilepath] = useState<string | null>(null);
  const [parsedPayload, setParsedPayload] =
    useState<ScheduleTransferPayload | null>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const schedulesQuery = useMemo(() => q('schedules').select('*'), []);
  const { schedules } = useSchedules({ query: schedulesQuery });

  const existingNames = useMemo(() => {
    const set = new Set<string>();
    for (const s of schedules) {
      const n = normalizeScheduleName(s.name);
      if (n) {
        set.add(n);
      }
    }
    return set;
  }, [schedules]);

  const rows = useMemo(() => {
    if (!parsedPayload) {
      return [];
    }
    return buildRows(parsedPayload, existingNames);
  }, [parsedPayload, existingNames]);

  const selectedInst = useSelected<JsonScheduleRow>(
    'schedules-json-import',
    rows,
    [],
  );

  const parseFile = useCallback(
    async (path: string) => {
      setParsing(true);
      setError(null);
      try {
        const response = await sendCatch('schedule/parse-import-json', {
          filepath: path,
        });
        if (response.error) {
          setError(response.error.message);
          setParsedPayload(null);
          setFilepath(null);
          return;
        }

        const data = response.data;
        if (!data) {
          setError(t('Could not read schedule file.'));
          setParsedPayload(null);
          setFilepath(null);
          return;
        }

        if (typeof data === 'object' && data != null && 'error' in data) {
          setError(
            typeof (data as { error: unknown }).error === 'string'
              ? (data as { error: string }).error
              : t('Could not read schedule file.'),
          );
          setParsedPayload(null);
          setFilepath(null);
          return;
        }

        const payload = data as ScheduleTransferPayload;
        setFilepath(path);
        setParsedPayload(payload);
      } finally {
        setParsing(false);
      }
    },
    [t],
  );

  const handleFileSelect = useCallback(async () => {
    setError(null);
    try {
      const openFileDialog = window.Actual?.openFileDialog;
      if (!openFileDialog) {
        setError(t('File selection is not available in this environment.'));
        return;
      }
      const filepaths = await openFileDialog({
        properties: ['openFile'],
        filters: [{ name: 'json5', extensions: ['json5', 'json'] }],
      });
      if (!filepaths || filepaths.length === 0) {
        return;
      }
      await parseFile(filepaths[0]);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('Failed to read schedule file.'),
      );
    }
  }, [parseFile, t]);

  const handleImport = useCallback(
    async (close: () => void) => {
      if (!filepath || selectedInst.items.size === 0) {
        return;
      }

      const indices = rows
        .filter(r => selectedInst.items.has(r.id))
        .map(r => r.index)
        .sort((a, b) => a - b);

      setImporting(true);
      setError(null);
      try {
        const selectedRows = rows.filter(r => selectedInst.items.has(r.id));
        const scheduleNamesByIndex = buildImportNameOverrides(
          selectedRows,
          existingNames,
        );

        const response = await sendCatch('schedule/import-json', {
          filepath,
          scheduleIndices: indices,
          ...(Object.keys(scheduleNamesByIndex).length > 0
            ? { scheduleNamesByIndex }
            : {}),
        });

        if (response.error) {
          setError(response.error.message);
          return;
        }

        const result = response.data;
        if (result && typeof result === 'object' && 'error' in result) {
          setError(
            typeof (result as { error: unknown }).error === 'string'
              ? (result as { error: string }).error
              : t('Import failed.'),
          );
          return;
        }

        if (!result || !('imported' in result)) {
          setError(t('Import failed.'));
          return;
        }

        const errs = result.errors ?? [];
        if (errs.length > 0) {
          const firstError = errs[0];
          setError(
            t(
              'Imported {{imported}}, skipped {{skipped}}. First issue ({{scheduleName}}): {{message}}',
              {
                imported: result.imported ?? 0,
                skipped: result.skipped ?? 0,
                scheduleName: firstError.scheduleName || t('unnamed schedule'),
                message: firstError.message,
              },
            ),
          );
          return;
        }

        close();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : t('Failed to import schedules.'),
        );
      } finally {
        setImporting(false);
      }
    },
    [existingNames, filepath, rows, selectedInst.items, t],
  );

  return (
    <Modal
      name="import-schedules-json"
      containerProps={{ style: { width: 900, height: 560 } }}
    >
      {({ state }) => (
        <>
          <ModalHeader
            title={t('Import schedules from JSON')}
            rightContent={<ModalCloseButton onPress={() => state.close()} />}
          />

          {!parsedPayload ? (
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
                  maxWidth: 480,
                  marginBottom: 20,
                }}
              >
                <Paragraph style={{ marginBottom: 12 }}>
                  <Trans>
                    Choose a schedules export file (.json5 or .json) from this
                    or another budget. You will be able to pick which schedules
                    to import on the next step.
                  </Trans>
                </Paragraph>
              </View>
              <ButtonWithLoading
                variant="primary"
                isLoading={parsing}
                onPress={() => void handleFileSelect()}
              >
                <Trans>Select file</Trans>
              </ButtonWithLoading>
              {error && (
                <Text style={{ color: theme.errorText, marginTop: 15 }}>
                  {error}
                </Text>
              )}
            </View>
          ) : (
            <>
              <Paragraph style={{ marginBottom: 10 }}>
                <Trans>
                  Select the schedules to import. Rows flagged with a warning
                  may match an existing schedule name in this budget.
                </Trans>
              </Paragraph>

              <SelectedProvider instance={selectedInst}>
                <JsonImportTable rows={rows} dateFormat={dateFormat} />
              </SelectedProvider>

              {error && (
                <Text style={{ color: theme.errorText, marginTop: 10 }}>
                  {error}
                </Text>
              )}

              <SpaceBetween
                style={{
                  paddingTop: 16,
                  paddingBottom: 0,
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <Button onPress={() => void handleFileSelect()}>
                  <Trans>Select different file</Trans>
                </Button>
                <ButtonWithLoading
                  variant="primary"
                  isLoading={importing}
                  isDisabled={selectedInst.items.size === 0}
                  onPress={() => void handleImport(() => state.close())}
                >
                  <Trans>Import selected</Trans>
                </ButtonWithLoading>
              </SpaceBetween>
            </>
          )}
        </>
      )}
    </Modal>
  );
}
