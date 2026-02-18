import type { AccountEntity } from 'loot-core/types/models';

export type GroupedAccountsBySubgroup = {
  ungroupedAccounts: AccountEntity[];
  subgroupEntries: Array<[string, AccountEntity[]]>;
};

export function compareBySubgroupOrder(
  a: string,
  b: string,
  subgroupOrderByName: ReadonlyMap<string, number>,
): number {
  const aOrder = subgroupOrderByName.get(a) ?? Number.POSITIVE_INFINITY;
  const bOrder = subgroupOrderByName.get(b) ?? Number.POSITIVE_INFINITY;
  if (aOrder !== bOrder) {
    return aOrder - bOrder;
  }
  return a.localeCompare(b);
}

export function groupAccountsBySubgroup(
  accounts: AccountEntity[],
): GroupedAccountsBySubgroup {
  const ungroupedAccounts: AccountEntity[] = [];
  const subgroupMap = new Map<string, AccountEntity[]>();
  const subgroupOrderByName = new Map<string, number>();

  for (const account of accounts) {
    if (!account.subgroup) {
      ungroupedAccounts.push(account);
      continue;
    }

    const groupedAccounts = subgroupMap.get(account.subgroup);
    if (groupedAccounts) {
      groupedAccounts.push(account);
    } else {
      subgroupMap.set(account.subgroup, [account]);
    }

    if (
      account.subgroup_sort_order != null &&
      !subgroupOrderByName.has(account.subgroup)
    ) {
      subgroupOrderByName.set(account.subgroup, account.subgroup_sort_order);
    }
  }

  const subgroupEntries = [...subgroupMap.entries()].sort(([a], [b]) =>
    compareBySubgroupOrder(a, b, subgroupOrderByName),
  );

  return { ungroupedAccounts, subgroupEntries };
}
