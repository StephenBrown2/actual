BEGIN TRANSACTION;

CREATE TABLE account_subgroups
  (id TEXT PRIMARY KEY,
   name TEXT,
   sort_order REAL,
   tombstone INTEGER NOT NULL DEFAULT 1);

ALTER TABLE accounts ADD COLUMN subgroup TEXT;
CREATE INDEX idx_accounts_subgroup ON accounts(subgroup);

-- When an account is created with a subgroup, that new account is an active
-- reference, so the subgroup must be marked active.
CREATE TRIGGER account_subgroups_tombstone_on_account_insert
AFTER INSERT ON accounts
WHEN NEW.subgroup IS NOT NULL
BEGIN
  UPDATE account_subgroups
  SET tombstone = 0
  WHERE id = NEW.subgroup;
END;

-- Recompute subgroup tombstones when an account changes subgroup or tombstone.
-- This handles moving accounts between subgroups and soft delete/restore cases.
CREATE TRIGGER account_subgroups_tombstone_on_account_update
AFTER UPDATE OF subgroup, tombstone ON accounts
BEGIN
  UPDATE account_subgroups
  SET tombstone =
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM accounts a
        WHERE a.subgroup = account_subgroups.id
          AND a.tombstone = 0
      )
      THEN 0
      ELSE 1
    END
  WHERE id = OLD.subgroup OR id = NEW.subgroup;
END;

-- Recompute subgroup tombstone after account deletion.
-- If no active accounts still reference the subgroup, it becomes tombstoned.
CREATE TRIGGER account_subgroups_tombstone_on_account_delete
AFTER DELETE ON accounts
WHEN OLD.subgroup IS NOT NULL
BEGIN
  UPDATE account_subgroups
  SET tombstone =
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM accounts a
        WHERE a.subgroup = account_subgroups.id
          AND a.tombstone = 0
      )
      THEN 0
      ELSE 1
    END
  WHERE id = OLD.subgroup;
END;

-- Activate a newly inserted subgroup row if active accounts
-- already reference it (for out-of-order sync/apply scenarios).
CREATE TRIGGER account_subgroups_tombstone_on_subgroup_insert
AFTER INSERT ON account_subgroups
BEGIN
  UPDATE account_subgroups
  SET tombstone = 0
  WHERE id = NEW.id
    AND EXISTS (
      SELECT 1
      FROM accounts a
      WHERE a.subgroup = NEW.id
        AND a.tombstone = 0
    );
END;

COMMIT;
