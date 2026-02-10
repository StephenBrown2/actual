import React, { useCallback, useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';

import { send } from 'loot-core/platform/client/fetch';
import { q } from 'loot-core/shared/query';
import type { ScheduleEntity } from 'loot-core/types/models';

import { SchedulesTable } from './SchedulesTable';
import type { ScheduleItemAction } from './SchedulesTable';

import { Search } from '@desktop-client/components/common/Search';
import { Page } from '@desktop-client/components/Page';
import { useMetadataPref } from '@desktop-client/hooks/useMetadataPref';
import { useSchedules } from '@desktop-client/hooks/useSchedules';
import { pushModal } from '@desktop-client/modals/modalsSlice';
import { addNotification } from '@desktop-client/notifications/notificationsSlice';
import { useDispatch } from '@desktop-client/redux';

export function Schedules() {
  const { t } = useTranslation();

  const dispatch = useDispatch();
  const [filter, setFilter] = useState('');
  const [budgetName] = useMetadataPref('budgetName');
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const isBusy = isImporting || isExporting;

  const notify = useCallback(
    (type: 'error' | 'warning' | 'message', message: string) => {
      dispatch(
        addNotification({
          notification: {
            type,
            message,
          },
        }),
      );
    },
    [dispatch],
  );

  const notifyUnknownFailure = useCallback(
    (operation: 'exporting' | 'importing') => {
      const message =
        operation === 'exporting'
          ? t(
              'An unknown error occurred while exporting schedules. Please report this as a new issue on GitHub.',
            )
          : t(
              'An unknown error occurred while importing schedules. Please report this as a new issue on GitHub.',
            );
      notify('error', message);
    },
    [notify, t],
  );

  const onEdit = useCallback(
    (id: ScheduleEntity['id']) => {
      dispatch(
        pushModal({ modal: { name: 'schedule-edit', options: { id } } }),
      );
    },
    [dispatch],
  );

  const onAdd = useCallback(() => {
    dispatch(pushModal({ modal: { name: 'schedule-edit', options: {} } }));
  }, [dispatch]);

  const onDiscover = useCallback(() => {
    dispatch(pushModal({ modal: { name: 'schedules-discover' } }));
  }, [dispatch]);

  const onChangeUpcomingLength = useCallback(() => {
    dispatch(pushModal({ modal: { name: 'schedules-upcoming-length' } }));
  }, [dispatch]);

  const onExportSchedules = useCallback(async () => {
    setIsExporting(true);
    try {
      const response = await send('export-schedules');
      if ('error' in response && response.error) {
        notifyUnknownFailure('exporting');
        return;
      }

      if (response.data) {
        const day = new Date().toISOString().slice(0, 10);
        const fileName = `${day}-${budgetName || 'budget'}-schedules.json5`;
        window.Actual.saveFile(response.data, fileName, t('Export schedules'));
        notify('message', t('Schedules exported to "{{fileName}}".', { fileName }));
      }
    } finally {
      setIsExporting(false);
    }
  }, [budgetName, notify, notifyUnknownFailure, t]);

  const onImportSchedules = useCallback(async () => {
    const filepaths = await window.Actual.openFileDialog({
      properties: ['openFile'],
      filters: [{ name: 'json5', extensions: ['json5', 'json'] }],
    });
    if (!filepaths || filepaths.length === 0) {
      return;
    }

    setIsImporting(true);
    try {
      const response = await send('import-schedules', {
        filepath: filepaths[0],
      });
      if ('error' in response && response.error) {
        notifyUnknownFailure('importing');
        return;
      }

      const firstError = response.errors?.[0];
      const summary = t(
        'Imported {{imported}} schedules, skipped {{skipped}}.',
        {
          imported: response.imported ?? 0,
          skipped: response.skipped ?? 0,
        },
      );
      if (firstError) {
        notify(
          'warning',
          t('{{summary}} First error ({{scheduleName}}): {{message}}', {
            summary,
            scheduleName: firstError.scheduleName || t('unnamed schedule'),
            message: firstError.message,
          }),
        );
      } else {
        notify('message', summary);
      }
    } finally {
      setIsImporting(false);
    }
  }, [notify, notifyUnknownFailure, t]);

  const onAction = useCallback(
    async (name: ScheduleItemAction, id: ScheduleEntity['id']) => {
      switch (name) {
        case 'post-transaction':
          await send('schedule/post-transaction', { id });
          break;
        case 'post-transaction-today':
          await send('schedule/post-transaction', { id, today: true });
          break;
        case 'skip':
          await send('schedule/skip-next-date', { id });
          break;
        case 'complete':
          await send('schedule/update', {
            schedule: { id, completed: true },
          });
          break;
        case 'restart':
          await send('schedule/update', {
            schedule: { id, completed: false },
            resetNextDate: true,
          });
          break;
        case 'delete':
          await send('schedule/delete', { id });
          break;
        default:
          throw new Error(`Unknown action: ${name}`);
      }
    },
    [],
  );

  const schedulesQuery = useMemo(() => q('schedules').select('*'), []);
  const {
    isLoading: isSchedulesLoading,
    schedules,
    statuses,
  } = useSchedules({ query: schedulesQuery });

  return (
    <Page header={t('Schedules')}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          padding: '0 0 15px',
        }}
      >
        <View
          style={{
            flex: 1,
            flexDirection: 'row',
            justifyContent: 'flex-end',
          }}
        >
          <Search
            placeholder={t('Filter schedules…')}
            value={filter}
            onChange={setFilter}
          />
        </View>
      </View>

      <SchedulesTable
        isLoading={isSchedulesLoading}
        schedules={schedules}
        filter={filter}
        statuses={statuses}
        allowCompleted
        onSelect={onEdit}
        onAction={onAction}
        style={{ backgroundColor: theme.tableBackground }}
      />

      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          margin: '20px 0',
          flexShrink: 0,
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: '1em',
          }}
        >
          <Button
            onPress={onImportSchedules}
            isDisabled={isBusy}
          >
            <Trans>Import schedules</Trans>
          </Button>
          <Button
            onPress={onExportSchedules}
            isDisabled={isBusy}
          >
            <Trans>Export schedules</Trans>
          </Button>
          <Button onPress={onDiscover}>
            <Trans>Find schedules</Trans>
          </Button>
          <Button onPress={onChangeUpcomingLength}>
            <Trans>Change upcoming length</Trans>
          </Button>
        </View>
        <Button variant="primary" onPress={onAdd}>
          <Trans>Add new schedule</Trans>
        </Button>
      </View>
    </Page>
  );
}
