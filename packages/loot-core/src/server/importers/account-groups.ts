import { send } from '#server/main-app';

/**
 * Resolves account group names (e.g. bank account types like "Checking",
 * "Savings") to their `account_group_id`s, creating any that don't exist
 * yet. Resolves sequentially and up front — before any concurrent account
 * creation — so two accounts that need the same new group can't race to
 * create it twice. `account-create` doesn't accept a group directly, so
 * callers assign the id to each newly created account via a follow-up
 * `account-update`.
 */
export async function resolveAccountGroups(
  names: Array<string | undefined | null>,
): Promise<Map<string, string>> {
  const existing = await send('api/account-groups-get');
  const idByName = new Map(existing.map(group => [group.name, group.id]));

  for (const name of new Set(names.filter((n): n is string => !!n))) {
    if (!idByName.has(name)) {
      const id = await send('api/account-group-create', { group: { name } });
      idByName.set(name, id);
    }
  }

  return idByName;
}
