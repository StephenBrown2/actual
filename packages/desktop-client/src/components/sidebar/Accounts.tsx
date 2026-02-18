import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import {
  Button as AriaButton,
  Collection,
  Tree,
  TreeItem,
  TreeItemContent,
  useDragAndDrop,
} from 'react-aria-components';
import type { Key } from 'react-aria-components';
import { useTranslation } from 'react-i18next';

import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { css } from '@emotion/css';

import type { AccountEntity } from 'loot-core/types/models';

import { Account } from './Account';
import { AccountGroupHeader } from './AccountGroupHeader';
import { AccountSubgroupHeader } from './AccountSubgroupHeader';

import {
  useMoveAccountMutation,
  useMoveAccountSubgroupMutation,
  useUpdateAccountMutation,
} from '@desktop-client/accounts';
import { groupAccountsBySubgroup } from '@desktop-client/accounts/accountSubgroups';
import { useAccounts } from '@desktop-client/hooks/useAccounts';
import { useClosedAccounts } from '@desktop-client/hooks/useClosedAccounts';
import { useFailedAccounts } from '@desktop-client/hooks/useFailedAccounts';
import { useLocalPref } from '@desktop-client/hooks/useLocalPref';
import { useOffBudgetAccounts } from '@desktop-client/hooks/useOffBudgetAccounts';
import { useOnBudgetAccounts } from '@desktop-client/hooks/useOnBudgetAccounts';
import { useUpdatedAccounts } from '@desktop-client/hooks/useUpdatedAccounts';
import { useSelector } from '@desktop-client/redux';
import type { Binding, SheetFields } from '@desktop-client/spreadsheet';
import * as bindings from '@desktop-client/spreadsheet/bindings';

const fontWeight = 600;

const visuallyHiddenStyle: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0,0,0,0)',
  border: 0,
};

const ALL_ACCOUNTS_KEY = 'all-accounts';
const ON_BUDGET_KEY = 'onbudget';
const OFF_BUDGET_KEY = 'offbudget';
const CLOSED_ACCOUNTS_KEY = 'closed';
const SEEN_KEY_PREFIX = 'seen:';

const STRUCTURAL_EXPANDED_KEYS = [
  ALL_ACCOUNTS_KEY,
  ON_BUDGET_KEY,
  OFF_BUDGET_KEY,
];

const SUBGROUP_SEPARATOR = '-subgroup-';

type TreeNode = {
  id: string;
  name: string;
  children?: TreeNode[];
  account?: AccountEntity;
  to?: string;
  query?: Binding<'account', SheetFields<'account'>>;
  isSubgroup?: boolean;
};

const NON_DRAGGABLE_KEYS = new Set([
  ALL_ACCOUNTS_KEY,
  ON_BUDGET_KEY,
  OFF_BUDGET_KEY,
  CLOSED_ACCOUNTS_KEY,
]);

function isSubgroupKey(key: string): boolean {
  return key.includes(SUBGROUP_SEPARATOR);
}

function getBudgetPrefixFromSubgroupKey(subgroupKey: string): string {
  return subgroupKey.split(SUBGROUP_SEPARATOR)[0];
}

function getSubgroupNameFromKey(subgroupKey: string): string {
  const separatorIndex = subgroupKey.indexOf(SUBGROUP_SEPARATOR);
  if (separatorIndex === -1) {
    return '';
  }
  return subgroupKey.slice(separatorIndex + SUBGROUP_SEPARATOR.length);
}

function getIsOffBudgetForDropTargetKey(key: string): boolean | null {
  if (key === ON_BUDGET_KEY) {
    return false;
  }
  if (key === OFF_BUDGET_KEY) {
    return true;
  }
  if (isSubgroupKey(key)) {
    return getBudgetPrefixFromSubgroupKey(key) === OFF_BUDGET_KEY;
  }
  return null;
}

function isTextDragItem(item: { kind: string }): item is {
  kind: 'text';
  getText: (type: string) => Promise<string>;
} {
  return (
    item.kind === 'text' &&
    'getText' in item &&
    typeof (item as { getText?: unknown }).getText === 'function'
  );
}

function buildSubgroupTreeNodes(
  accounts: AccountEntity[],
  budgetPrefix: string,
): TreeNode[] {
  const { ungroupedAccounts, subgroupEntries } =
    groupAccountsBySubgroup(accounts);
  const isOffBudget = budgetPrefix === OFF_BUDGET_KEY;
  const subgroupNodes: TreeNode[] = subgroupEntries.map(
    ([subgroupName, groupedAccounts]) => ({
      id: `${budgetPrefix}${SUBGROUP_SEPARATOR}${subgroupName}`,
      name: subgroupName,
      isSubgroup: true,
      query: bindings.accountSubgroupBalance(subgroupName, isOffBudget),
      children: groupedAccounts.map(account => ({
        id: account.id,
        name: account.name,
        account,
      })),
    }),
  );

  return [
    ...ungroupedAccounts.map(account => ({
      id: account.id,
      name: account.name,
      account,
    })),
    ...subgroupNodes,
  ];
}

function getAccountIds(nodes: TreeNode[] | undefined): string[] {
  return nodes?.filter(node => !!node.account).map(node => node.id) ?? [];
}

export function Accounts() {
  const { t } = useTranslation();
  const { data: accounts = [] } = useAccounts();
  const failedAccounts = useFailedAccounts();
  const updatedAccounts = useUpdatedAccounts();
  const offbudgetAccounts = useOffBudgetAccounts();
  const onBudgetAccounts = useOnBudgetAccounts();
  const closedAccounts = useClosedAccounts();
  const syncingAccountIds = useSelector(state => state.account.accountsSyncing);

  const [savedExpandedKeys, setSavedExpandedKeys] = useLocalPref(
    'sidebar.expandedKeys',
  );

  const treeItems = useMemo(() => {
    const children: TreeNode[] = [];

    if (onBudgetAccounts.length > 0) {
      children.push({
        id: ON_BUDGET_KEY,
        name: t('On budget'),
        to: '/accounts/onbudget',
        query: bindings.onBudgetAccountBalance(),
        children: buildSubgroupTreeNodes(onBudgetAccounts, ON_BUDGET_KEY),
      });
    }

    if (offbudgetAccounts.length > 0) {
      children.push({
        id: OFF_BUDGET_KEY,
        name: t('Off budget'),
        to: '/accounts/offbudget',
        query: bindings.offBudgetAccountBalance(),
        children: buildSubgroupTreeNodes(offbudgetAccounts, OFF_BUDGET_KEY),
      });
    }

    if (closedAccounts.length > 0) {
      children.push({
        id: CLOSED_ACCOUNTS_KEY,
        name: t('Closed accounts'),
        query: bindings.closedAccountBalance(),
        children: closedAccounts.map(account => ({
          id: account.id,
          name: account.name,
          account,
        })),
      });
    }

    return [
      {
        id: ALL_ACCOUNTS_KEY,
        name: t('All accounts'),
        to: '/accounts',
        query: bindings.allAccountBalance(),
        children,
      },
    ];
  }, [onBudgetAccounts, offbudgetAccounts, closedAccounts, t]);

  const allSubgroupKeys = useMemo(() => {
    const keys: string[] = [];
    function walk(nodes: TreeNode[]) {
      for (const node of nodes) {
        if (node.isSubgroup) {
          keys.push(node.id);
        }
        if (node.children) {
          walk(node.children);
        }
      }
    }
    walk(treeItems);
    return keys;
  }, [treeItems]);

  const savedExpanded = useMemo(() => {
    if (!savedExpandedKeys) {
      return null;
    }
    const expanded = new Set<Key>();
    const seen = new Set<string>();
    for (const key of savedExpandedKeys) {
      if (key.startsWith(SEEN_KEY_PREFIX)) {
        seen.add(key.slice(SEEN_KEY_PREFIX.length));
      } else {
        expanded.add(key);
      }
    }
    return { expanded, seen };
  }, [savedExpandedKeys]);

  const expandedKeys = useMemo(() => {
    if (!savedExpanded) {
      return new Set<Key>([...STRUCTURAL_EXPANDED_KEYS, ...allSubgroupKeys]);
    }
    const unseenSubgroupKeys = allSubgroupKeys.filter(
      key => !savedExpanded.seen.has(key),
    );
    return new Set<Key>([...savedExpanded.expanded, ...unseenSubgroupKeys]);
  }, [savedExpanded, allSubgroupKeys]);

  const expandedKeysRef = useRef<Set<Key>>(new Set(expandedKeys));
  useEffect(() => {
    expandedKeysRef.current = new Set(expandedKeys);
  }, [expandedKeys]);

  const persistExpandedKeys = useCallback(
    (keys: Set<Key>) => {
      expandedKeysRef.current = new Set(keys);
      const seenMarkers = allSubgroupKeys.map(
        key => `${SEEN_KEY_PREFIX}${key}`,
      );
      setSavedExpandedKeys([...keys].map(String).concat(seenMarkers));
    },
    [allSubgroupKeys, setSavedExpandedKeys],
  );

  const onExpandedChange = persistExpandedKeys;

  useEffect(() => {
    if (!savedExpandedKeys) {
      return;
    }
    const persistedNonSeen = savedExpandedKeys.filter(
      key => !key.startsWith(SEEN_KEY_PREFIX),
    );
    const unseenSubgroupKeys = allSubgroupKeys.filter(
      key => !savedExpandedKeys.includes(`${SEEN_KEY_PREFIX}${key}`),
    );
    const next = persistedNonSeen
      .concat(unseenSubgroupKeys)
      .concat(allSubgroupKeys.map(key => `${SEEN_KEY_PREFIX}${key}`));
    const currentSet = new Set(savedExpandedKeys);
    const nextSet = new Set(next);
    const isSame =
      currentSet.size === nextSet.size &&
      [...currentSet].every(key => nextSet.has(key));
    if (!isSame) {
      setSavedExpandedKeys(next);
    }
  }, [allSubgroupKeys, savedExpandedKeys, setSavedExpandedKeys]);

  const toggleExpanded = useCallback(
    (key: string) => {
      const next = new Set(expandedKeysRef.current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      persistExpandedKeys(next);
    },
    [persistExpandedKeys],
  );

  function findAccountById(id: string): AccountEntity | undefined {
    return accounts.find(a => a.id === id);
  }

  function findSubgroupForKey(key: Key): string | null {
    const keyStr = String(key);
    return isSubgroupKey(keyStr) ? getSubgroupNameFromKey(keyStr) : null;
  }

  const getAccountContainerKey = useCallback(
    (accountId: string): string | null => {
      const rootChildren = treeItems[0]?.children ?? [];
      for (const group of rootChildren) {
        const groupChildren = group.children ?? [];
        if (groupChildren.some(node => node.id === accountId && node.account)) {
          return group.id;
        }
        for (const node of groupChildren) {
          if (
            node.isSubgroup &&
            node.children?.some(
              child => child.id === accountId && child.account != null,
            )
          ) {
            return node.id;
          }
        }
      }
      return null;
    },
    [treeItems],
  );

  const getSubgroupKeysForPrefix = useCallback(
    (prefix: string): string[] => {
      const budgetNode = treeItems[0]?.children?.find(c => c.id === prefix);
      return (
        budgetNode?.children?.filter(c => c.isSubgroup).map(c => c.id) ?? []
      );
    },
    [treeItems],
  );

  const getAccountSiblingIdsForTarget = useCallback(
    (targetAccountId: string): string[] => {
      const rootChildren = treeItems[0]?.children ?? [];
      for (const group of rootChildren) {
        const groupChildren = group.children ?? [];

        const untypedGroupIds = getAccountIds(groupChildren);
        if (untypedGroupIds.includes(targetAccountId)) {
          return untypedGroupIds;
        }

        for (const node of groupChildren) {
          if (!node.isSubgroup) {
            continue;
          }
          const typedGroupIds = getAccountIds(node.children);
          if (typedGroupIds.includes(targetAccountId)) {
            return typedGroupIds;
          }
        }
      }

      console.warn(
        'Unable to find sibling accounts for drag target account id:',
        targetAccountId,
      );
      return [];
    },
    [treeItems],
  );

  const moveAccount = useMoveAccountMutation();
  const moveAccountSubgroup = useMoveAccountSubgroupMutation();
  const updateAccount = useUpdateAccountMutation();

  function applyAccountSubgroupToItems(
    items: Iterable<{ kind: string }>,
    nextSubgroup: string | null,
  ) {
    for (const item of items) {
      if (isTextDragItem(item)) {
        item
          .getText('text/plain')
          .then(accountId => {
            const account = findAccountById(accountId);
            if (account) {
              updateAccount.mutate({
                account: { ...account, subgroup: nextSubgroup },
              });
            }
          })
          .catch(error => {
            console.error('Unable to read dragged account id', error);
          });
      }
    }
  }

  const draggedKeysRef = useRef<Set<Key>>(new Set());

  const { dragAndDropHooks } = useDragAndDrop({
    getItems(keys) {
      draggedKeysRef.current = new Set(keys);
      const draggable = [...keys].filter(
        key => !NON_DRAGGABLE_KEYS.has(String(key)),
      );
      return draggable.map(key => ({
        'text/plain': String(key),
      }));
    },
    onReorder(e) {
      const [key] = e.keys;
      const keyStr = String(key);
      const targetStr = String(e.target.key);
      const isSubgroupDrag = isSubgroupKey(keyStr);
      const isSubgroupTarget = isSubgroupKey(targetStr);

      if (isSubgroupDrag && isSubgroupTarget) {
        if (e.target.dropPosition === 'before') {
          moveAccountSubgroup.mutate({
            subgroup: getSubgroupNameFromKey(keyStr),
            targetSubgroup: getSubgroupNameFromKey(targetStr),
          });
        } else {
          const prefix = getBudgetPrefixFromSubgroupKey(keyStr);
          const subgroupKeys = getSubgroupKeysForPrefix(prefix).filter(
            subgroupKey => subgroupKey !== keyStr,
          );
          const targetIdx = subgroupKeys.indexOf(targetStr);
          const nextSubgroup = subgroupKeys[targetIdx + 1]
            ? getSubgroupNameFromKey(subgroupKeys[targetIdx + 1])
            : null;
          moveAccountSubgroup.mutate({
            subgroup: getSubgroupNameFromKey(keyStr),
            targetSubgroup: nextSubgroup,
          });
        }
        return;
      }

      if (!isSubgroupDrag) {
        const accountId = keyStr;
        const targetAccountId = targetStr;

        if (e.target.dropPosition === 'before') {
          moveAccount.mutate({ id: accountId, targetId: targetAccountId });
        } else if (e.target.dropPosition === 'after') {
          const siblingIds = getAccountSiblingIdsForTarget(targetAccountId);
          if (siblingIds.length === 0) {
            return;
          }
          const targetIdx = siblingIds.findIndex(id => id === targetAccountId);
          if (targetIdx < 0) {
            return;
          }
          const nextAccountId = siblingIds[targetIdx + 1];
          moveAccount.mutate({
            id: accountId,
            targetId: nextAccountId || null,
          });
        }
      }
    },
    onItemDrop(e) {
      if (e.target.dropPosition !== 'on') {
        return;
      }

      const targetKey = String(e.target.key);
      const subgroupName = findSubgroupForKey(e.target.key);

      if (subgroupName) {
        applyAccountSubgroupToItems(e.items, subgroupName);
        return;
      }

      if (targetKey === ON_BUDGET_KEY || targetKey === OFF_BUDGET_KEY) {
        applyAccountSubgroupToItems(e.items, null);
      }
    },
    acceptedDragTypes: ['text/plain'],
    getDropOperation(target) {
      if (!('key' in target)) {
        return 'cancel';
      }
      const key = String(target.key);

      if (
        target.dropPosition === 'on' &&
        (isSubgroupKey(key) || key === ON_BUDGET_KEY || key === OFF_BUDGET_KEY)
      ) {
        const hasDraggedSubgroup = [...draggedKeysRef.current].some(
          draggedKey => isSubgroupKey(String(draggedKey)),
        );
        if (hasDraggedSubgroup) {
          return 'cancel';
        }

        const isTargetOffBudget = getIsOffBudgetForDropTargetKey(key);
        if (isTargetOffBudget != null) {
          for (const draggedKey of draggedKeysRef.current) {
            const draggedKeyStr = String(draggedKey);
            if (
              !isSubgroupKey(draggedKeyStr) &&
              !NON_DRAGGABLE_KEYS.has(draggedKeyStr)
            ) {
              const account = findAccountById(draggedKeyStr);
              if (account && Boolean(account.offbudget) !== isTargetOffBudget) {
                return 'cancel';
              }
            }
          }
        }
        return 'move';
      }

      if (isSubgroupKey(key) && target.dropPosition !== 'on') {
        const targetPrefix = getBudgetPrefixFromSubgroupKey(key);
        for (const draggedKey of draggedKeysRef.current) {
          const draggedKeyStr = String(draggedKey);
          if (!isSubgroupKey(draggedKeyStr)) {
            return 'cancel';
          }
          const draggedPrefix = getBudgetPrefixFromSubgroupKey(draggedKeyStr);
          if (draggedPrefix !== targetPrefix) {
            return 'cancel';
          }
        }
        return 'move';
      }

      const account = findAccountById(key);
      if (account && target.dropPosition !== 'on') {
        const targetContainerKey = getAccountContainerKey(key);
        if (!targetContainerKey) {
          return 'cancel';
        }
        for (const draggedKey of draggedKeysRef.current) {
          const draggedKeyStr = String(draggedKey);
          if (
            isSubgroupKey(draggedKeyStr) ||
            NON_DRAGGABLE_KEYS.has(draggedKeyStr)
          ) {
            return 'cancel';
          }
          const draggedAccount = findAccountById(draggedKeyStr);
          if (!draggedAccount) {
            return 'cancel';
          }
          if (
            getAccountContainerKey(draggedAccount.id) !== targetContainerKey
          ) {
            return 'cancel';
          }
        }
        return 'move';
      }

      return 'cancel';
    },
  });

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
        <Tree
          aria-label={t('Accounts')}
          items={treeItems}
          expandedKeys={expandedKeys}
          onExpandedChange={onExpandedChange}
          dragAndDropHooks={dragAndDropHooks}
          selectionMode="none"
          className={css({
            outline: 'none',
            padding: 0,
            margin: 0,
            listStyle: 'none',
            '& [role="treeitem"]': {
              outline: 'none',
              listStyle: 'none',
            },
            '& [role="group"]': {
              padding: 0,
              margin: 0,
              listStyle: 'none',
            },
            '& [role="row"][data-drop-target]': {
              backgroundColor: theme.sidebarItemBackgroundHover,
              boxShadow: `inset 0 0 0 1px ${theme.sidebarItemAccentSelected}`,
              borderRadius: 4,
            },
            '& .react-aria-DropIndicator': {
              outline: 'none',
              border: 'none',
              margin: 0,
              padding: 0,
              height: 0,
              background: 'none',
            },
            '& .react-aria-DropIndicator[data-drop-target]': {
              height: 1,
              backgroundColor: theme.sidebarItemAccentSelected,
            },
          })}
        >
          {function renderTreeItem(node: TreeNode) {
            if (node.account) {
              return (
                <TreeItem key={node.id} id={node.id} textValue={node.name}>
                  <TreeItemContent>
                    <Account
                      name={node.account.name}
                      account={node.account}
                      style={{ paddingLeft: 8 }}
                      connected={!!node.account.bank}
                      pending={syncingAccountIds.includes(node.account.id)}
                      failed={failedAccounts.has(node.account.id)}
                      updated={updatedAccounts.includes(node.account.id)}
                      to={`/accounts/${node.account.id}`}
                      query={bindings.accountBalance(node.account.id)}
                    />
                    <AriaButton slot="drag" style={visuallyHiddenStyle}>
                      ≡
                    </AriaButton>
                  </TreeItemContent>
                </TreeItem>
              );
            }

            if (node.isSubgroup) {
              return (
                <TreeItem key={node.id} id={node.id} textValue={node.name}>
                  <TreeItemContent>
                    {({ isExpanded }) => (
                      <>
                        <AriaButton
                          slot="chevron"
                          style={visuallyHiddenStyle}
                        />
                        <AriaButton slot="drag" style={visuallyHiddenStyle}>
                          ≡
                        </AriaButton>
                        <AccountSubgroupHeader
                          subgroupName={node.name}
                          isExpanded={isExpanded}
                          onToggle={() => toggleExpanded(node.id)}
                          query={node.query}
                        />
                      </>
                    )}
                  </TreeItemContent>
                  {node.children && (
                    <Collection items={node.children}>
                      {renderTreeItem}
                    </Collection>
                  )}
                </TreeItem>
              );
            }

            const isRoot = node.id === ALL_ACCOUNTS_KEY;
            return (
              <TreeItem key={node.id} id={node.id} textValue={node.name}>
                <TreeItemContent>
                  {({ isExpanded }) => (
                    <>
                      <AriaButton slot="chevron" style={visuallyHiddenStyle} />
                      {node.to && node.query ? (
                        <AccountGroupHeader
                          name={node.name}
                          to={node.to}
                          query={node.query}
                          isRoot={isRoot}
                          isExpanded={isExpanded}
                          onToggle={() => toggleExpanded(node.id)}
                        />
                      ) : (
                        <View
                          onClick={e => {
                            e.stopPropagation();
                            toggleExpanded(node.id);
                          }}
                          style={{
                            fontWeight,
                            color: theme.sidebarItemText,
                            padding: '14px 10px 10px',
                            display: 'flex',
                            flexDirection: 'row',
                            alignItems: 'center',
                            cursor: 'pointer',
                          }}
                        >
                          {isExpanded ? node.name : `${node.name}...`}
                        </View>
                      )}
                    </>
                  )}
                </TreeItemContent>
                {node.children && (
                  <Collection items={node.children}>
                    {renderTreeItem}
                  </Collection>
                )}
              </TreeItem>
            );
          }}
        </Tree>
      </View>
    </View>
  );
}
