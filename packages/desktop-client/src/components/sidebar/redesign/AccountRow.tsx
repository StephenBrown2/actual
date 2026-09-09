import { useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { radius, spacing } from '@actual-app/components/tokens';
import { View } from '@actual-app/components/view';
import type { AccountEntity } from '@actual-app/core/types/models';

import { isAccountFailedSync } from '#accounts/syncStatus';
import { Link } from '#components/common/Link';
import { useContextMenu } from '#hooks/useContextMenu';
import { useUpdatedAccounts } from '#hooks/useUpdatedAccounts';
import { pushModal } from '#modals/modalsSlice';
import { useDispatch, useSelector } from '#redux';
import * as bindings from '#spreadsheet/bindings';

import { SidebarBalance } from './SidebarBalance';
import { SyncDot, useSyncDotLabel } from './SyncDot';
import type { SyncDotStatus } from './SyncDot';

type AccountRowProps = {
  account: AccountEntity;
  isClosed?: boolean;
  showSyncDot?: boolean;
};

export function AccountRow({
  account,
  isClosed,
  showSyncDot,
}: AccountRowProps) {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const triggerRef = useRef(null);
  const syncingAccountIds = useSelector(state => state.account.accountsSyncing);
  const updatedAccounts = useUpdatedAccounts();
  const isUpdated = !isClosed && updatedAccounts.includes(account.id);

  useContextMenu({
    triggerRef,
    items: [
      {
        name: 'account-group',
        text: t('Change group'),
        onClick: () =>
          dispatch(
            pushModal({
              modal: {
                name: 'account-groups',
                options: { accountId: account.id },
              },
            }),
          ),
      },
    ],
  });

  let status: SyncDotStatus = 'unlinked';
  if (!isClosed && account.bank) {
    if (isAccountFailedSync(account)) {
      status = 'error';
    } else if (syncingAccountIds.includes(account.id)) {
      status = 'pending';
    } else {
      status = 'synced';
    }
  }
  const statusLabel = useSyncDotLabel(status);

  return (
    <View innerRef={triggerRef}>
      <Link
        variant="internal"
        to={`/accounts/${account.id}`}
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          paddingBlock: spacing.xs,
          paddingInline: spacing.sm,
          borderRadius: radius.sm,
          fontSize: 13,
          textDecoration: isClosed ? 'line-through' : 'none',
          color: isClosed ? theme.sidebarTextMuted : theme.sidebarItemText,
          ':hover': { backgroundColor: theme.sidebarItemBackgroundHover },
          ...(isUpdated && {
            fontWeight: 700,
            color: theme.sidebarItemTextUpdated,
          }),
        }}
        activeStyle={{
          backgroundColor: theme.sidebarItemBackgroundSelected,
          color: theme.sidebarItemTextSelected,
          fontWeight: 'normal',
        }}
      >
        {showSyncDot ? <SyncDot status={status} /> : null}
        <Text style={{ flex: 1, ...styles.ellipsisText }}>{account.name}</Text>
        <Text style={styles.visuallyHidden}>{statusLabel}</Text>
        <SidebarBalance
          binding={bindings.accountBalance(account.id)}
          style={{ fontSize: 12, color: 'inherit' }}
        />
      </Link>
    </View>
  );
}
