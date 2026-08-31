import type { SqlDatabase } from '../database';
import {
  initializePersonalDatabaseV2,
  LegacyDemoResetRequiredError,
} from './v2';

export const PERSONAL_SCHEMA_VERSION_V3 = 3;
export const PERSONAL_V3_CHECKSUM = 'personal-v3-photo-purpose-2026-08-26';

export async function initializePersonalDatabaseV3(
  database: SqlDatabase,
  appliedAtUtc: string,
): Promise<void> {
  await database.execAsync('PRAGMA foreign_keys = ON;');
  await database.execAsync('PRAGMA journal_mode = WAL;');
  let current = await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let currentVersion = current?.user_version ?? 0;
  if (currentVersion === 1) throw new LegacyDemoResetRequiredError();
  if (currentVersion === 0) {
    await initializePersonalDatabaseV2(database, appliedAtUtc);
    current = await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    currentVersion = current?.user_version ?? 2;
  }
  if (currentVersion > PERSONAL_SCHEMA_VERSION_V3) {
    throw new Error(`Unsupported personal schema version: ${currentVersion}`);
  }
  if (currentVersion === PERSONAL_SCHEMA_VERSION_V3) return;
  if (currentVersion !== 2) {
    throw new Error(`Unsupported personal schema migration source: ${currentVersion}`);
  }

  await database.withTransactionAsync(async () => {
    await database.execAsync(
      `ALTER TABLE photo_evidence
       ADD COLUMN capture_purpose TEXT NOT NULL DEFAULT 'initial'
       CHECK (capture_purpose IN ('initial','retake'));`,
    );
    await database.runAsync(
      `INSERT INTO migration_journal(version,name,checksum,applied_at_utc) VALUES(?,?,?,?)`,
      PERSONAL_SCHEMA_VERSION_V3,
      'personal_v3',
      PERSONAL_V3_CHECKSUM,
      appliedAtUtc,
    );
    await database.execAsync(`PRAGMA user_version = ${PERSONAL_SCHEMA_VERSION_V3};`);
  });
}
