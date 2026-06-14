import React, { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Block } from '@actual-app/components/block';
import { Button } from '@actual-app/components/button';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { send } from '@actual-app/core/platform/client/connection';

import { Modal, ModalCloseButton, ModalHeader } from '#components/common/Modal';
import { pushModal } from '#modals/modalsSlice';
import { useDispatch } from '#redux';

export function SchedulesImportExportModal() {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const [error] = useState(false);

  async function onExportIcal() {
    const icalStr = await send('schedule/export-ical');
    const blob = new Blob([icalStr], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'actual-schedules.ics';
    a.click();
    URL.revokeObjectURL(url);
  }

  function getErrorMessage(err: boolean) {
    switch (err) {
      default:
        return t(
          'An unknown error occurred while importing. Please report this as a new issue on GitHub.',
        );
    }
  }

  const itemStyle = {
    padding: 10,
    border: '1px solid ' + theme.tableBorder,
    borderRadius: 6,
    marginBottom: 10,
    display: 'block',
  };

  return (
    <Modal
      name="schedules-import-export"
      containerProps={{ style: { width: 400 } }}
    >
      {({ state }) => (
        <>
          <ModalHeader
            title={t('Import / Export schedules')}
            rightContent={<ModalCloseButton onPress={() => state.close()} />}
          />
          <View style={{ ...styles.smallText, lineHeight: 1.5 }}>
            {error && (
              <Block style={{ color: theme.errorText, marginBottom: 15 }}>
                {getErrorMessage(error)}
              </Block>
            )}

            <Text style={{ marginBottom: 15 }}>
              <Trans>
                Export schedules to JSON or iCal, import a schedules file from
                another budget, or import subscriptions from Wallos.
              </Trans>
            </Text>

            <Button
              style={itemStyle}
              onPress={() =>
                dispatch(
                  pushModal({ modal: { name: 'export-schedules-json' } }),
                )
              }
            >
              <span style={{ fontWeight: 700 }}>
                <Trans>Export to JSON</Trans>
              </span>
              <View style={{ color: theme.pageTextLight }}>
                <Trans>
                  Save a JSON file with schedules and linked rule data
                </Trans>
              </View>
            </Button>

            <Button style={itemStyle} onPress={onExportIcal}>
              <span style={{ fontWeight: 700 }}>
                <Trans>Export to Calendar (.ics)</Trans>
              </span>
              <View style={{ color: theme.pageTextLight }}>
                <Trans>
                  Download a calendar file to import into Google Calendar, Apple
                  Calendar, or any other iCal-compatible app
                </Trans>
              </View>
            </Button>

            <Button
              style={itemStyle}
              onPress={() =>
                dispatch(
                  pushModal({ modal: { name: 'import-schedules-json' } }),
                )
              }
            >
              <span style={{ fontWeight: 700 }}>
                <Trans>Import from JSON</Trans>
              </span>
              <View style={{ color: theme.pageTextLight }}>
                <Trans>
                  Choose a file, pick which schedules to import, then confirm
                </Trans>
              </View>
            </Button>

            <Button
              style={itemStyle}
              onPress={() =>
                dispatch(pushModal({ modal: { name: 'import-wallos' } }))
              }
            >
              <span style={{ fontWeight: 700 }}>
                <Trans>Import from Wallos</Trans>
              </span>
              <View style={{ color: theme.pageTextLight }}>
                <Trans>Import subscription exports as schedules</Trans>
              </View>
            </Button>
          </View>
        </>
      )}
    </Modal>
  );
}
