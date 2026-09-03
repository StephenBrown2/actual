import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import type {
  AccountEntity,
  AccountGroupEntity,
} from '@actual-app/core/types/models';

import { useMoveAccountMutation } from '#accounts';
import { isAccountFailedSync } from '#accounts/syncStatus';
import { useAccountGroups } from '#hooks/useAccountGroups';
import { useAccounts } from '#hooks/useAccounts';
import { useClosedAccounts } from '#hooks/useClosedAccounts';
import { useLocalPref } from '#hooks/useLocalPref';
import { useOffBudgetAccounts } from '#hooks/useOffBudgetAccounts';
import { useOnBudgetAccounts } from '#hooks/useOnBudgetAccounts';
import { useUpdatedAccounts } from '#hooks/useUpdatedAccounts';
import { useSelector } from '#redux';
import * as bindings from '#spreadsheet/bindings';

import { Account, accountNameStyle } from './Account';
import { SecondaryItem } from './SecondaryItem';

const fontWeight = 600;
// Extra indent added on top of the account row's own base paddingLeft, so
// grouped accounts nest under their header instead of shifting left.
const groupIndent = 8;
const groupedAccountPaddingLeft =
  (accountNameStyle.paddingLeft as number) + groupIndent;
// SecondaryItem's own paddingLeft is 14 + indent; back out an indent that
// lands the header at the same paddingLeft as its member rows.
const groupHeaderIndent = groupedAccountPaddingLeft - 14;

export function groupAccounts(
  accounts: AccountEntity[],
  groups: AccountGroupEntity[],
) {
  const byGroup = new Map<string, AccountEntity[]>();
  const ungrouped: AccountEntity[] = [];
  for (const account of accounts) {
    if (account.account_group_id) {
      const bucket = byGroup.get(account.account_group_id);
      if (bucket) {
        bucket.push(account);
      } else {
        byGroup.set(account.account_group_id, [account]);
      }
    } else {
      ungrouped.push(account);
    }
  }
  const validGroupIds = new Set(
    groups.filter(group => !group.tombstone).map(group => group.id),
  );
  const orderedGroups = groups
    .filter(group => !group.tombstone && byGroup.has(group.id))
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(group => ({ group, accounts: byGroup.get(group.id)! }));
  // A ref to a missing/tombstoned group must be treated as ungrouped — see
  // the comment on deleteAccountGroup in loot-core's db/index.ts.
  for (const [groupId, groupAccountsList] of byGroup) {
    if (!validGroupIds.has(groupId)) {
      ungrouped.push(...groupAccountsList);
    }
  }
  return { orderedGroups, ungrouped };
}

export function Accounts() {
  const { t } = useTranslation();
  const [isDragging, setIsDragging] = useState(false);
  const { data: accounts = [] } = useAccounts();
  const updatedAccounts = useUpdatedAccounts();
  const { data: offbudgetAccounts = [] } = useOffBudgetAccounts();
  const { data: onBudgetAccounts = [] } = useOnBudgetAccounts();
  const { data: closedAccounts = [] } = useClosedAccounts();
  const { data: accountGroups = [] } = useAccountGroups();
  const syncingAccountIds = useSelector(state => state.account.accountsSyncing);

  const getAccountPath = (account: AccountEntity) => `/accounts/${account.id}`;

  const [showClosedAccounts, setShowClosedAccountsPref] = useLocalPref(
    'ui.showClosedAccounts',
  );

  function onDragChange(drag: { state: string }) {
    setIsDragging(drag.state === 'start');
  }

  const moveAccount = useMoveAccountMutation();

  const makeDropPadding = (i: number) => {
    if (i === 0) {
      return {
        paddingTop: isDragging ? 15 : 0,
        marginTop: isDragging ? -15 : 0,
      };
    }
    return undefined;
  };

  async function onReorder(
    id: string,
    dropPos: 'top' | 'bottom' | null,
    targetId: string,
  ) {
    let targetIdToMove: string | null = targetId;
    if (dropPos === 'bottom') {
      const idx = accounts.findIndex(a => a.id === targetId) + 1;
      targetIdToMove = idx < accounts.length ? accounts[idx].id : null;
    }

    moveAccount.mutate({ id, targetId: targetIdToMove });
  }

  const onToggleClosedAccounts = () => {
    setShowClosedAccountsPref(!showClosedAccounts);
  };

  const renderAccountList = (accountList: AccountEntity[], grouped = false) =>
    accountList.map((account, i) => (
      <Account
        key={account.id}
        name={account.name}
        account={account}
        connected={!!account.bank}
        pending={syncingAccountIds.includes(account.id)}
        failed={isAccountFailedSync(account)}
        updated={updatedAccounts.includes(account.id)}
        to={getAccountPath(account)}
        query={bindings.accountBalance(account.id)}
        onDragChange={onDragChange}
        onDrop={onReorder}
        outerStyle={makeDropPadding(i)}
        style={grouped ? { paddingLeft: groupedAccountPaddingLeft } : undefined}
      />
    ));

  const renderAccountSection = (accountList: AccountEntity[]) => {
    const { orderedGroups, ungrouped } = groupAccounts(
      accountList,
      accountGroups,
    );
    return (
      <>
        {orderedGroups.map(({ group, accounts: groupAccountsList }) => (
          <Fragment key={group.id}>
            <SecondaryItem title={group.name} indent={groupHeaderIndent} />
            {renderAccountList(groupAccountsList, true)}
          </Fragment>
        ))}
        {renderAccountList(ungrouped)}
      </>
    );
  };

  return (
    <View
      style={{
        flexGrow: 1,
        '@media screen and (max-height: 480px)': {
          minHeight: 'auto',
        },
      }}
    >
      <View
        style={{
          height: 1,
          backgroundColor: theme.sidebarItemBackgroundHover,
          marginTop: 15,
          flexShrink: 0,
        }}
      />

      <View style={{ overflow: 'auto' }}>
        <Account
          name={t('All accounts')}
          to="/accounts"
          query={bindings.allAccountBalance()}
          style={{ fontWeight, marginTop: 15 }}
          isExactPathMatch
          balanceTestId="sidebar-all-accounts-balance"
        />

        {onBudgetAccounts.length > 0 && (
          <Account
            name={t('On budget')}
            to="/accounts/onbudget"
            query={bindings.onBudgetAccountBalance()}
            style={{
              fontWeight,
              marginTop: 13,
              marginBottom: 5,
            }}
            titleAccount
            balanceTestId="sidebar-on-budget-balance"
          />
        )}

        {renderAccountSection(onBudgetAccounts)}

        {offbudgetAccounts.length > 0 && (
          <Account
            name={t('Off budget')}
            to="/accounts/offbudget"
            query={bindings.offBudgetAccountBalance()}
            style={{
              fontWeight,
              marginTop: 13,
              marginBottom: 5,
            }}
            titleAccount
            balanceTestId="sidebar-off-budget-balance"
          />
        )}

        {renderAccountSection(offbudgetAccounts)}

        {closedAccounts.length > 0 && (
          <SecondaryItem
            style={{ marginTop: 15 }}
            title={
              showClosedAccounts
                ? t('Closed accounts')
                : t('Closed accounts...')
            }
            onClick={onToggleClosedAccounts}
            bold
          />
        )}

        {showClosedAccounts &&
          closedAccounts.map(account => (
            <Account
              key={account.id}
              name={account.name}
              account={account}
              to={getAccountPath(account)}
              query={bindings.accountBalance(account.id)}
              onDragChange={onDragChange}
              onDrop={onReorder}
            />
          ))}
      </View>
    </View>
  );
}
