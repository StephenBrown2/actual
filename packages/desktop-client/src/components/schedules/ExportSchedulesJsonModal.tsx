import React, { useCallback, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Block } from '@actual-app/components/block';
import { ButtonWithLoading } from '@actual-app/components/button';
import { Paragraph } from '@actual-app/components/paragraph';
import { styles } from '@actual-app/components/styles';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { sendCatch } from '@actual-app/core/platform/client/connection';

import { Modal, ModalCloseButton, ModalHeader } from '#components/common/Modal';
import { useMetadataPref } from '#hooks/useMetadataPref';

export function ExportSchedulesJsonModal() {
  const { t } = useTranslation();
  const [budgetName] = useMetadataPref('budgetName');
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onExport = useCallback(
    async (close: () => void) => {
      setExporting(true);
      setError(null);
      try {
        const response = await sendCatch('schedule/export-json');
        if (response.error) {
          setError(
            t(
              'An unknown error occurred while exporting schedules. Please report this as a new issue on GitHub.',
            ),
          );
          return;
        }

        const payload = response.data;
        if (payload && 'error' in payload && payload.error) {
          setError(
            t(
              'An unknown error occurred while exporting schedules. Please report this as a new issue on GitHub.',
            ),
          );
          return;
        }

        if (payload && 'data' in payload && payload.data) {
          const day = new Date().toISOString().slice(0, 10);
          const fileName = `${day}-${budgetName || 'budget'}-schedules.json`;
          await window.Actual.saveFile(
            payload.data,
            fileName,
            t('Export schedules'),
          );
          close();
        }
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : t(
                'An unknown error occurred while exporting schedules. Please report this as a new issue on GitHub.',
              ),
        );
      } finally {
        setExporting(false);
      }
    },
    [budgetName, t],
  );

  return (
    <Modal
      name="export-schedules-json"
      containerProps={{ style: { width: 440 } }}
    >
      {({ state }) => (
        <>
          <ModalHeader
            title={t('Export schedules to JSON')}
            rightContent={<ModalCloseButton onPress={() => state.close()} />}
          />
          <View style={{ ...styles.smallText, lineHeight: 1.5 }}>
            {error && (
              <Block style={{ color: theme.errorText, marginBottom: 15 }}>
                {error}
              </Block>
            )}
            <Paragraph style={{ marginBottom: 12 }}>
              <Trans>Export all schedules in this budget to a JSON file.</Trans>
            </Paragraph>
            <Paragraph style={{ marginBottom: 12 }}>
              <Trans>
                Account, payee, category names and rule data are included so the
                file can be imported into another budget.
              </Trans>
            </Paragraph>
            <ButtonWithLoading
              variant="primary"
              isLoading={exporting}
              onPress={() => void onExport(() => state.close())}
            >
              <Trans>Export</Trans>
            </ButtonWithLoading>
          </View>
        </>
      )}
    </Modal>
  );
}
