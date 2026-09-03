import type { SqlDatabase } from '../database';
import { initializePersonalDatabaseV5 } from './v5';

export const PERSONAL_SCHEMA_VERSION_V6 = 6;
export const PERSONAL_V6_CHECKSUM = 'multi-schedule-v6-20260902';

/** V6 is strictly additive over V5; null projection dates preserve legacy behaviour. */
export const PERSONAL_V6_SCHEMA = `
ALTER TABLE medications ADD COLUMN status_effective_local_date TEXT;
ALTER TABLE regimens ADD COLUMN retirement_effective_local_date TEXT;

CREATE TABLE regimen_retirement_facts (
  command_id TEXT PRIMARY KEY,
  regimen_id TEXT NOT NULL REFERENCES regimens(id) ON DELETE RESTRICT,
  effective_local_date TEXT NOT NULL,
  recorded_at_utc TEXT NOT NULL,
  UNIQUE(regimen_id)
);
CREATE INDEX idx_regimen_retirement_effective
  ON regimen_retirement_facts(effective_local_date,regimen_id);
`;

export async function initializePersonalDatabaseV6(
  database: SqlDatabase,
  now: string,
): Promise<void> {
  await database.execAsync('PRAGMA foreign_keys = ON;');
  await database.execAsync('PRAGMA journal_mode = WAL;');
  let currentVersion =
    (await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))
      ?.user_version ?? 0;
  if (currentVersion < 5) {
    await initializePersonalDatabaseV5(database, now);
    currentVersion = 5;
  }
  if (currentVersion === PERSONAL_SCHEMA_VERSION_V6) return;
  if (currentVersion !== 5) {
    throw new Error(`Unsupported personal schema version: ${currentVersion}`);
  }

  await database.withTransactionAsync(async () => {
    await database.execAsync(PERSONAL_V6_SCHEMA);
    await database.runAsync(
      'INSERT INTO migration_journal(version,name,checksum,applied_at_utc) VALUES(?,?,?,?)',
      PERSONAL_SCHEMA_VERSION_V6,
      'personal_v6',
      PERSONAL_V6_CHECKSUM,
      now,
    );
    await database.execAsync(`PRAGMA user_version = ${PERSONAL_SCHEMA_VERSION_V6};`);
  });
}
