import { generateAccount } from '@actual-app/core/mocks';
import type { AccountGroupEntity } from '@actual-app/core/types/models';

import { groupAccounts } from './Accounts';

function generateGroup(
  overrides: Partial<AccountGroupEntity> & Pick<AccountGroupEntity, 'id'>,
): AccountGroupEntity {
  return { name: overrides.id, sort_order: 0, ...overrides };
}

describe('groupAccounts', () => {
  it('puts accounts with no account_group_id in ungrouped', () => {
    const account = generateAccount('Checking');

    const { orderedGroups, ungrouped } = groupAccounts(
      [account],
      [generateGroup({ id: 'g1' })],
    );

    expect(orderedGroups).toEqual([]);
    expect(ungrouped).toEqual([account]);
  });

  it('buckets accounts by account_group_id and orders groups by sort_order', () => {
    const savings = { ...generateAccount('Savings'), account_group_id: 'g2' };
    const checking = {
      ...generateAccount('Checking'),
      account_group_id: 'g1',
    };
    const other = { ...generateAccount('Other'), account_group_id: 'g2' };

    const groups = [
      generateGroup({ id: 'g1', name: 'Personal', sort_order: 2 }),
      generateGroup({ id: 'g2', name: 'Business', sort_order: 1 }),
    ];

    const { orderedGroups, ungrouped } = groupAccounts(
      [savings, checking, other],
      groups,
    );

    expect(orderedGroups).toEqual([
      { group: groups[1], accounts: [savings, other] },
      { group: groups[0], accounts: [checking] },
    ]);
    expect(ungrouped).toEqual([]);
  });

  it('omits empty groups from orderedGroups', () => {
    const checking = {
      ...generateAccount('Checking'),
      account_group_id: 'g1',
    };
    const groups = [
      generateGroup({ id: 'g1', name: 'Personal' }),
      generateGroup({ id: 'g2', name: 'Empty' }),
    ];

    const { orderedGroups } = groupAccounts([checking], groups);

    expect(orderedGroups).toEqual([{ group: groups[0], accounts: [checking] }]);
  });

  it('treats a ref to a missing or tombstoned group as ungrouped', () => {
    const missingRef = {
      ...generateAccount('Missing group'),
      account_group_id: 'does-not-exist',
    };
    const tombstonedRef = {
      ...generateAccount('Deleted group'),
      account_group_id: 'g3',
    };
    const groups = [
      generateGroup({ id: 'g3', name: 'Deleted', tombstone: true }),
    ];

    const { orderedGroups, ungrouped } = groupAccounts(
      [missingRef, tombstonedRef],
      groups,
    );

    expect(orderedGroups).toEqual([]);
    expect(ungrouped).toEqual([missingRef, tombstonedRef]);
  });
});
