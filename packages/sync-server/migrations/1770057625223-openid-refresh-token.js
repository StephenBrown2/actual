import { getAccountDb } from '../src/account-db';

export const up = async function () {
  await getAccountDb().exec(`
    ALTER TABLE sessions
      ADD COLUMN refresh_token TEXT
        CHECK (refresh_token IS NULL OR auth_method = 'openid');
  `);
};

export const down = async function () {
  await getAccountDb().exec(`
    BEGIN TRANSACTION;

    CREATE TABLE sessions_backup (
      token TEXT PRIMARY KEY,
      expires_at INTEGER,
      user_id TEXT,
      auth_method TEXT
    );

    INSERT INTO sessions_backup (token, expires_at, user_id, auth_method)
    SELECT token, expires_at, user_id, auth_method FROM sessions;

    DROP TABLE sessions;
    ALTER TABLE sessions_backup RENAME TO sessions;

    COMMIT;
  `);
};
