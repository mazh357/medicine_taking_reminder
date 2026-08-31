import type { SqlDatabase } from '../database';
import {
  initializePersonalDatabaseV3,
  PERSONAL_SCHEMA_VERSION_V3,
} from './v3';

export const PERSONAL_SCHEMA_VERSION_V4 = 4;
export const PERSONAL_V4_CHECKSUM = 'personal-v4-forecast-follow-up-2026-08-26';

export const PERSONAL_V4_SCHEMA = `
CREATE TABLE IF NOT EXISTS inventory_forecast_preferences (
  medication_id TEXT PRIMARY KEY REFERENCES medications(id) ON DELETE RESTRICT,
  lead_days INTEGER CHECK (lead_days IS NULL OR lead_days IN (3,7,14,30)),
  updated_at_utc TEXT NOT NULL,
  row_version INTEGER NOT NULL CHECK (row_version > 0)
);

CREATE TABLE IF NOT EXISTS follow_up_items (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('follow_up','refill','test')),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 80),
  due_at_utc TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  medication_id TEXT REFERENCES medications(id) ON DELETE RESTRICT,
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 500),
  advance_days INTEGER CHECK (advance_days IS NULL OR advance_days IN (1,3,7)),
  status TEXT NOT NULL CHECK (status IN ('pending','completed','cancelled')),
  completed_at_utc TEXT,
  cancelled_at_utc TEXT,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  row_version INTEGER NOT NULL CHECK (row_version > 0),
  CHECK (
    (status='pending' AND completed_at_utc IS NULL AND cancelled_at_utc IS NULL)
    OR (status='completed' AND completed_at_utc IS NOT NULL AND cancelled_at_utc IS NULL)
    OR (status='cancelled' AND cancelled_at_utc IS NOT NULL AND completed_at_utc IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_follow_up_open_due
  ON follow_up_items(status,due_at_utc,id);
CREATE INDEX IF NOT EXISTS idx_follow_up_medication
  ON follow_up_items(medication_id,status,due_at_utc);

CREATE TABLE IF NOT EXISTS follow_up_item_events (
  id TEXT PRIMARY KEY,
  follow_up_item_id TEXT NOT NULL REFERENCES follow_up_items(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN ('created','edited','completed','cancelled')),
  previous_status TEXT CHECK (previous_status IS NULL OR previous_status IN ('pending','completed','cancelled')),
  new_status TEXT NOT NULL CHECK (new_status IN ('pending','completed','cancelled')),
  snapshot_json TEXT NOT NULL,
  recorded_at_utc TEXT NOT NULL,
  command_id TEXT NOT NULL,
  UNIQUE(follow_up_item_id,command_id)
);
CREATE INDEX IF NOT EXISTS idx_follow_up_events_time
  ON follow_up_item_events(follow_up_item_id,recorded_at_utc,id);

CREATE TABLE IF NOT EXISTS auxiliary_reminder_intents (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('refill','follow_up_advance','follow_up_due')),
  source_type TEXT NOT NULL CHECK (source_type IN ('medication','follow_up_item')),
  source_id TEXT NOT NULL,
  medication_id TEXT REFERENCES medications(id) ON DELETE RESTRICT,
  follow_up_item_id TEXT REFERENCES follow_up_items(id) ON DELETE RESTRICT,
  trigger_at_utc TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','cancelled','completed')),
  projection_version INTEGER NOT NULL CHECK (projection_version > 0),
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  UNIQUE(kind,source_type,source_id),
  CHECK (
    (kind='refill' AND source_type='medication' AND medication_id=source_id
      AND follow_up_item_id IS NULL)
    OR (kind IN ('follow_up_advance','follow_up_due') AND source_type='follow_up_item'
      AND follow_up_item_id=source_id AND medication_id IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_auxiliary_intents_trigger
  ON auxiliary_reminder_intents(status,trigger_at_utc,kind);

CREATE TABLE IF NOT EXISTS auxiliary_reminder_projections (
  reminder_intent_id TEXT PRIMARY KEY REFERENCES auxiliary_reminder_intents(id) ON DELETE RESTRICT,
  system_notification_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending_rebuild','scheduled','failed','cancel_pending','cancelled','obsolete')),
  failure_code TEXT,
  last_reconciled_at_utc TEXT,
  row_version INTEGER NOT NULL CHECK (row_version > 0)
);
`;

export async function initializePersonalDatabaseV4(
  database: SqlDatabase,
  appliedAtUtc: string,
): Promise<void> {
  await database.execAsync('PRAGMA foreign_keys = ON;');
  await database.execAsync('PRAGMA journal_mode = WAL;');
  let current = await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let currentVersion = current?.user_version ?? 0;
  if (currentVersion <= 2) {
    await initializePersonalDatabaseV3(database, appliedAtUtc);
    current = await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    currentVersion = current?.user_version ?? PERSONAL_SCHEMA_VERSION_V3;
  }
  if (currentVersion > PERSONAL_SCHEMA_VERSION_V4) {
    throw new Error(`Unsupported personal schema version: ${currentVersion}`);
  }
  if (currentVersion === PERSONAL_SCHEMA_VERSION_V4) return;
  if (currentVersion !== PERSONAL_SCHEMA_VERSION_V3) {
    throw new Error(`Unsupported personal schema migration source: ${currentVersion}`);
  }

  await database.withTransactionAsync(async () => {
    await database.execAsync(PERSONAL_V4_SCHEMA);
    await database.runAsync(
      `INSERT INTO inventory_forecast_preferences(
         medication_id,lead_days,updated_at_utc,row_version
       ) SELECT id,7,?,1 FROM medications
       WHERE NOT EXISTS(
         SELECT 1 FROM inventory_forecast_preferences p WHERE p.medication_id=medications.id
       )`,
      appliedAtUtc,
    );
    await database.runAsync(
      `INSERT INTO migration_journal(version,name,checksum,applied_at_utc) VALUES(?,?,?,?)`,
      PERSONAL_SCHEMA_VERSION_V4,
      'personal_v4',
      PERSONAL_V4_CHECKSUM,
      appliedAtUtc,
    );
    await database.execAsync(`PRAGMA user_version = ${PERSONAL_SCHEMA_VERSION_V4};`);
  });
}
