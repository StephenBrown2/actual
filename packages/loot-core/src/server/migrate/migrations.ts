// @ts-strict-ignore
// We have to bundle in JS migrations manually to avoid having to `eval`
// them which doesn't play well with CSP. There isn't great, and eventually
// we can remove this migration.
import type { Database } from '@jlongster/sql.js';

import m1632571489012 from '#migrations/1632571489012_remove_cache';
import m1722717601000 from '#migrations/1722717601000_reports_move_selected_categories';
import m1722804019000 from '#migrations/1722804019000_create_dashboard_table';
import m1723665565000 from '#migrations/1723665565000_prefs';
import m1765518577215 from '#migrations/1765518577215_multiple_dashboards';
import * as fs from '#platform/server/fs';
import { logger } from '#platform/server/log';
import * as sqlite from '#platform/server/sqlite';
import * as prefs from '#server/prefs';

let MIGRATIONS_DIR = fs.migrationsPath;

const javascriptMigrations = {
  1632571489012: m1632571489012,
  1722717601000: m1722717601000,
  1722804019000: m1722804019000,
  1723665565000: m1723665565000,
  1765518577215: m1765518577215,
};

export async function withMigrationsDir(
  dir: string,
  func: () => Promise<void>,
): Promise<void> {
  const oldDir = MIGRATIONS_DIR;
  MIGRATIONS_DIR = dir;
  await func();
  MIGRATIONS_DIR = oldDir;
}

export function getMigrationsDir(): string {
  return MIGRATIONS_DIR;
}

function getMigrationId(name: string): number {
  return parseInt(name.match(/^(\d)+/)[0]);
}

export function getUpMigration(id, names) {
  for (const m of names) {
    if (getMigrationId(m) === id) {
      return m;
    }
  }
}

async function patchBadMigrations(db: Database) {
  const badFiltersMigration = 1685375406832;
  const newFiltersMigration = 1688749527273;
  const appliedIds = await getAppliedMigrations(db);
  if (appliedIds.includes(badFiltersMigration)) {
    sqlite.runQuery(db, 'DELETE FROM __migrations__ WHERE id = ?', [
      badFiltersMigration,
    ]);
    sqlite.runQuery(db, 'INSERT INTO __migrations__ (id) VALUES (?)', [
      newFiltersMigration,
    ]);
  }
}

// A fork-local migration this database may have applied before account
// grouping shipped upstream: `account_subgroups` + `accounts.subgroup`,
// pre-dating the `account_groups` table + `accounts.account_group_id`
// column upstream PR #8764 actually added. No file for this id ships in
// MIGRATIONS_DIR, so `checkDatabaseValidity` would reject any database
// that recorded it as applied.
const LEGACY_ACCOUNT_SUBGROUPS_MIGRATION_ID = 1771016572494;

async function tableExists(db: Database, name: string): Promise<boolean> {
  const rows = sqlite.runQuery<{ name: string }>(
    db,
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
    [name],
    true,
  );
  return rows.length > 0;
}

// Drops the tracking row for the legacy migration above, so a database that
// applied it lines up with `available` again and the real `account_groups`
// migration runs normally. `account_subgroups` existing is our only signal
// this database ever ran the fork-local migration — its own row was long
// since either applied for real elsewhere or removed here.
async function unstickLegacyAccountSubgroupsMigration(db: Database) {
  if (await tableExists(db, 'account_subgroups')) {
    sqlite.runQuery(db, 'DELETE FROM __migrations__ WHERE id = ?', [
      LEGACY_ACCOUNT_SUBGROUPS_MIGRATION_ID,
    ]);
  }
}

// Converts data from the legacy `account_subgroups` table into
// `account_groups` + `accounts.account_group_id`. Runs after pending
// migrations apply, so `account_groups` is guaranteed to exist by the time
// this runs. Drops `account_subgroups` once done, so this — and the unstick
// step above — never run again on a database that's already been converted.
async function migrateLegacyAccountSubgroups(db: Database) {
  if (!(await tableExists(db, 'account_subgroups'))) {
    return;
  }

  const subgroups = sqlite.runQuery<{
    id: string;
    name: string;
    sort_order: number;
    tombstone: number;
  }>(
    db,
    'SELECT id, name, sort_order, tombstone FROM account_subgroups',
    [],
    true,
  );

  for (const row of subgroups) {
    sqlite.runQuery(
      db,
      `INSERT INTO account_groups (id, name, sort_order, tombstone)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         name = excluded.name,
         sort_order = excluded.sort_order,
         tombstone = excluded.tombstone`,
      [row.id, row.name, row.sort_order, row.tombstone],
    );
    sqlite.runQuery(
      db,
      'UPDATE accounts SET account_group_id = ? WHERE subgroup = ?',
      [row.id, row.id],
    );
  }

  sqlite.runQuery(db, 'DROP TABLE account_subgroups');

  logger.info(
    `Migrated ${subgroups.length} legacy account group(s) from account_subgroups to account_groups`,
  );
}

export async function getAppliedMigrations(db: Database): Promise<number[]> {
  const rows = sqlite.runQuery<{ id: number }>(
    db,
    'SELECT * FROM __migrations__ ORDER BY id ASC',
    [],
    true,
  );
  return rows.map(row => row.id);
}

export async function getMigrationList(
  migrationsDir: string,
): Promise<string[]> {
  const files = await fs.listDir(migrationsDir);
  return files
    .filter(name => name.match(/(\.sql|\.js)$/))
    .sort((m1, m2) => {
      const id1 = getMigrationId(m1);
      const id2 = getMigrationId(m2);
      if (id1 < id2) {
        return -1;
      } else if (id1 > id2) {
        return 1;
      }
      return 0;
    });
}

export function getPending(appliedIds: number[], all: string[]): string[] {
  return all.filter(name => {
    const id = getMigrationId(name);
    return appliedIds.indexOf(id) === -1;
  });
}

async function applyJavaScript(db, id) {
  const dbInterface = {
    runQuery: (query, params, fetchAll) =>
      sqlite.runQuery(db, query, params, fetchAll),
    execQuery: query => sqlite.execQuery(db, query),
    transaction: func => sqlite.transaction(db, func),
  };

  if (javascriptMigrations[id] == null) {
    throw new Error('Could not find JS migration code to run for ' + id);
  }

  const run = javascriptMigrations[id];
  return run(dbInterface, {
    fs,
    fileId: prefs.getPrefs()?.id,
  });
}

async function applySql(db, sql) {
  try {
    sqlite.execQuery(db, sql);
  } catch (e) {
    logger.log('Error applying sql:', sql);
    throw e;
  }
}

export async function applyMigration(
  db: Database,
  name: string,
  migrationsDir: string,
): Promise<void> {
  const code = await fs.readFile(fs.join(migrationsDir, name));
  if (name.match(/\.js$/)) {
    await applyJavaScript(db, getMigrationId(name));
  } else {
    await applySql(db, code);
  }
  sqlite.runQuery(db, 'INSERT INTO __migrations__ (id) VALUES (?)', [
    getMigrationId(name),
  ]);
}

function checkDatabaseValidity(
  appliedIds: number[],
  available: string[],
): void {
  if (appliedIds.length > available.length) {
    logger.error(
      'Database is out of sync with migrations (index past available):',
      {
        appliedIds,
        available,
      },
    );
    throw new Error('out-of-sync-migrations');
  }

  for (let i = 0; i < appliedIds.length; i++) {
    if (appliedIds[i] !== getMigrationId(available[i])) {
      logger.error(
        'Database is out of sync with migrations (migration id mismatch):',
        {
          appliedIds,
          available,
          missing: available.filter(
            m => !appliedIds.includes(getMigrationId(m)),
          ),
        },
      );
      throw new Error('out-of-sync-migrations');
    }
  }
}

export async function migrate(db: Database): Promise<string[]> {
  await patchBadMigrations(db);
  await unstickLegacyAccountSubgroupsMigration(db);
  const appliedIds = await getAppliedMigrations(db);
  const available = await getMigrationList(MIGRATIONS_DIR);

  checkDatabaseValidity(appliedIds, available);

  const pending = getPending(appliedIds, available);

  for (const migration of pending) {
    await applyMigration(db, migration, MIGRATIONS_DIR);
  }

  await migrateLegacyAccountSubgroups(db);

  return pending;
}
