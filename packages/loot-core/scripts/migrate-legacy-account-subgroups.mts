/**
 * One-off personal migration: converts data from the old, pre-upstream
 * `account_subgroups` table (used by a local implementation of account
 * grouping written before upstream PRs #8764/#8832 landed) into the
 * `account_groups` table and `accounts.account_group_id` column that
 * upstream actually shipped.
 *
 * Not wired into `packages/loot-core/migrations/` on purpose: the old
 * `account_subgroups` table only ever existed on this fork's local
 * database files, so it must never run as part of the normal migration
 * chain every user's budget goes through.
 *
 * Usage: node packages/loot-core/scripts/migrate-legacy-account-subgroups.mts <path-to-budget.sqlite>
 */
import Database from 'better-sqlite3';

const dbPath = process.argv[2];
if (!dbPath) {
  console.error(
    'Usage: node migrate-legacy-account-subgroups.mts <path-to-budget.sqlite>',
  );
  process.exit(1);
}

const db = new Database(dbPath);

function tableExists(name: string): boolean {
  return (
    db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(name) != null
  );
}

if (!tableExists('account_subgroups')) {
  console.log(
    'No account_subgroups table found — nothing to migrate (already on the new schema, or never had the legacy one).',
  );
  process.exit(0);
}

if (!tableExists('account_groups')) {
  console.error(
    'account_groups table not found — open this budget with the current app (so its migrations run) before running this script.',
  );
  process.exit(1);
}

type LegacySubgroup = {
  id: string;
  name: string;
  sort_order: number;
  tombstone: number;
};

const subgroups = db
  .prepare<[], LegacySubgroup>(
    'SELECT id, name, sort_order, tombstone FROM account_subgroups',
  )
  .all();

const insertGroup = db.prepare(
  `INSERT INTO account_groups (id, name, sort_order, tombstone)
   VALUES (@id, @name, @sort_order, @tombstone)
   ON CONFLICT (id) DO UPDATE SET
     name = excluded.name,
     sort_order = excluded.sort_order,
     tombstone = excluded.tombstone`,
);

const assignAccounts = db.prepare(
  `UPDATE accounts SET account_group_id = ? WHERE subgroup = ?`,
);

const migrate = db.transaction((rows: LegacySubgroup[]) => {
  let groupCount = 0;
  let accountCount = 0;
  for (const row of rows) {
    insertGroup.run(row);
    groupCount++;
    accountCount += assignAccounts.run(row.id, row.id).changes;
  }
  return { groupCount, accountCount };
});

const { groupCount, accountCount } = migrate(subgroups);

console.log(
  `Migrated ${groupCount} account group(s) and reassigned ${accountCount} account(s) from account_subgroups to account_groups.`,
);
console.log(
  "The old account_subgroups table and accounts.subgroup column were left in place — nothing reads them anymore, so they can be dropped by hand once you've confirmed the new groups look right.",
);

db.close();
