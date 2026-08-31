import type { SqlDatabase } from '../database';

export const DEMO_SCHEMA_VERSION = 1;
export const DEMO_V1_CHECKSUM = 'demo-v1-2026-08-24';

export const DEMO_V1_SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS migration_journal (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at_utc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS demo_profile (
  id TEXT PRIMARY KEY CHECK (id = 'demo-profile'),
  disclaimer_version TEXT NOT NULL,
  acknowledged_at_utc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS medications (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL CHECK (display_name LIKE '演示%'),
  dosage_form TEXT NOT NULL CHECK (dosage_form IN ('tablet','capsule')),
  inventory_unit TEXT NOT NULL CHECK (inventory_unit IN ('tablet','capsule')),
  status TEXT NOT NULL CHECK (status IN ('active','inactive')),
  created_at_utc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_medications_status_name ON medications(status, display_name);

CREATE TABLE IF NOT EXISTS regimens (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  local_time TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  on_time_offset_minutes INTEGER NOT NULL CHECK (on_time_offset_minutes > 0),
  record_offset_minutes INTEGER NOT NULL CHECK (record_offset_minutes > on_time_offset_minutes),
  capture_mode TEXT NOT NULL CHECK (capture_mode IN ('group','per_item')),
  start_local_date TEXT NOT NULL,
  end_local_date TEXT,
  status TEXT NOT NULL CHECK (status IN ('active','paused')),
  row_version INTEGER NOT NULL CHECK (row_version > 0),
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_regimens_active_date ON regimens(status, start_local_date, end_local_date);

CREATE TABLE IF NOT EXISTS regimen_items (
  id TEXT PRIMARY KEY,
  regimen_id TEXT NOT NULL REFERENCES regimens(id) ON DELETE RESTRICT,
  medication_id TEXT NOT NULL REFERENCES medications(id) ON DELETE RESTRICT,
  planned_dose_quantity TEXT NOT NULL,
  unit TEXT NOT NULL CHECK (unit IN ('tablet','capsule')),
  sort_order INTEGER NOT NULL,
  UNIQUE(regimen_id, medication_id)
);

CREATE TABLE IF NOT EXISTS dose_occurrences (
  id TEXT PRIMARY KEY,
  regimen_id TEXT NOT NULL REFERENCES regimens(id) ON DELETE RESTRICT,
  local_service_date TEXT NOT NULL,
  scheduled_at_utc TEXT NOT NULL,
  on_time_until_at_utc TEXT NOT NULL,
  record_until_at_utc TEXT NOT NULL,
  current_lifecycle TEXT NOT NULL CHECK (current_lifecycle IN ('scheduled','due','prepared','taken_confirmed','late_taken','missed','revoked')),
  row_version INTEGER NOT NULL CHECK (row_version > 0),
  created_at_utc TEXT NOT NULL,
  UNIQUE(regimen_id, local_service_date)
);
CREATE INDEX IF NOT EXISTS idx_occurrences_date ON dose_occurrences(local_service_date, scheduled_at_utc);
CREATE INDEX IF NOT EXISTS idx_occurrences_lifecycle ON dose_occurrences(current_lifecycle, scheduled_at_utc);

CREATE TABLE IF NOT EXISTS dose_occurrence_items (
  id TEXT PRIMARY KEY,
  occurrence_id TEXT NOT NULL REFERENCES dose_occurrences(id) ON DELETE RESTRICT,
  regimen_item_id TEXT NOT NULL REFERENCES regimen_items(id) ON DELETE RESTRICT,
  medication_id TEXT NOT NULL REFERENCES medications(id) ON DELETE RESTRICT,
  medication_display_name TEXT NOT NULL,
  planned_dose_quantity TEXT NOT NULL,
  unit TEXT NOT NULL CHECK (unit IN ('tablet','capsule')),
  sort_order INTEGER NOT NULL,
  UNIQUE(occurrence_id, medication_id)
);
CREATE INDEX IF NOT EXISTS idx_occurrence_items_occurrence ON dose_occurrence_items(occurrence_id, sort_order);

CREATE TABLE IF NOT EXISTS dose_item_current (
  occurrence_item_id TEXT PRIMARY KEY REFERENCES dose_occurrence_items(id) ON DELETE RESTRICT,
  assertion TEXT NOT NULL CHECK (assertion IN ('pending','taken_as_planned','partially_taken','not_taken')),
  confirmed_consumption_quantity TEXT,
  active_fact_id TEXT,
  projection_version INTEGER NOT NULL CHECK (projection_version > 0)
);

CREATE TABLE IF NOT EXISTS dose_lifecycle_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  occurrence_id TEXT NOT NULL REFERENCES dose_occurrences(id) ON DELETE RESTRICT,
  from_state TEXT,
  to_state TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  effective_at_utc TEXT NOT NULL,
  recorded_at_utc TEXT NOT NULL,
  command_id TEXT NOT NULL,
  UNIQUE(occurrence_id, command_id, to_state)
);

CREATE TABLE IF NOT EXISTS photo_evidence (
  id TEXT PRIMARY KEY,
  occurrence_id TEXT NOT NULL REFERENCES dose_occurrences(id) ON DELETE RESTRICT,
  state TEXT NOT NULL CHECK (state IN ('captured','skipped_with_reason','deleted_tombstone')),
  capture_mode TEXT NOT NULL CHECK (capture_mode IN ('group','per_item')),
  private_relative_path TEXT,
  skip_reason_code TEXT,
  captured_at_utc TEXT,
  deleted_at_utc TEXT,
  created_at_utc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_photo_occurrence ON photo_evidence(occurrence_id, state);

CREATE TABLE IF NOT EXISTS photo_item_links (
  photo_evidence_id TEXT NOT NULL REFERENCES photo_evidence(id) ON DELETE RESTRICT,
  occurrence_item_id TEXT NOT NULL REFERENCES dose_occurrence_items(id) ON DELETE RESTRICT,
  PRIMARY KEY(photo_evidence_id, occurrence_item_id)
);

CREATE TABLE IF NOT EXISTS count_observations (
  id TEXT PRIMARY KEY,
  photo_evidence_id TEXT NOT NULL REFERENCES photo_evidence(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('counted','unable')),
  detected_object_count INTEGER CHECK (detected_object_count IS NULL OR detected_object_count >= 0),
  unable_reason_code TEXT,
  source TEXT NOT NULL CHECK (source IN ('contour_counter','manual_override')),
  algorithm_version TEXT NOT NULL,
  recorded_at_utc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_count_photo_time ON count_observations(photo_evidence_id, recorded_at_utc);

CREATE TABLE IF NOT EXISTS consumption_assertion_facts (
  id TEXT PRIMARY KEY,
  occurrence_item_id TEXT NOT NULL REFERENCES dose_occurrence_items(id) ON DELETE RESTRICT,
  assertion TEXT NOT NULL CHECK (assertion IN ('taken_as_planned','partially_taken','not_taken')),
  confirmed_consumption_quantity TEXT NOT NULL,
  asserted_consumed_at_utc TEXT,
  recorded_at_utc TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('initial','correction','missed_backfill')),
  supersedes_fact_id TEXT REFERENCES consumption_assertion_facts(id) ON DELETE RESTRICT,
  revision_group_id TEXT,
  command_id TEXT NOT NULL,
  UNIQUE(command_id, occurrence_item_id)
);

CREATE TABLE IF NOT EXISTS fact_revocations (
  id TEXT PRIMARY KEY,
  fact_id TEXT NOT NULL UNIQUE REFERENCES consumption_assertion_facts(id) ON DELETE RESTRICT,
  reason_code TEXT NOT NULL,
  revision_group_id TEXT,
  recorded_at_utc TEXT NOT NULL,
  command_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dose_item_missed_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  occurrence_item_id TEXT NOT NULL UNIQUE REFERENCES dose_occurrence_items(id) ON DELETE RESTRICT,
  record_until_at_utc TEXT NOT NULL,
  recorded_at_utc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory_ledger (
  id TEXT PRIMARY KEY,
  medication_id TEXT NOT NULL REFERENCES medications(id) ON DELETE RESTRICT,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('initial','restock','consumption','reversal','manual_adjustment')),
  quantity_delta TEXT NOT NULL CHECK (quantity_delta <> '0'),
  unit TEXT NOT NULL CHECK (unit IN ('tablet','capsule')),
  source_fact_type TEXT NOT NULL CHECK (source_fact_type IN ('medication','consumption_assertion','inventory_ledger','manual')),
  source_fact_id TEXT NOT NULL,
  reverses_entry_id TEXT UNIQUE REFERENCES inventory_ledger(id) ON DELETE RESTRICT,
  reason_code TEXT,
  effective_at_utc TEXT NOT NULL,
  recorded_at_utc TEXT NOT NULL,
  command_id TEXT NOT NULL,
  UNIQUE(source_fact_type, source_fact_id, entry_type)
);
CREATE INDEX IF NOT EXISTS idx_inventory_medication_time ON inventory_ledger(medication_id, effective_at_utc);

CREATE TABLE IF NOT EXISTS processed_commands (
  command_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_fingerprint TEXT NOT NULL,
  result_json TEXT NOT NULL,
  processed_at_utc TEXT NOT NULL,
  PRIMARY KEY(command_type, idempotency_key)
);
`;

export async function migrateDemoDatabaseV1(database: SqlDatabase, appliedAtUtc: string): Promise<void> {
  const current = await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const currentVersion = current?.user_version ?? 0;
  if (currentVersion > DEMO_SCHEMA_VERSION) {
    throw new Error(`Unsupported demo schema version: ${currentVersion}`);
  }
  if (currentVersion === DEMO_SCHEMA_VERSION) return;

  await database.withTransactionAsync(async () => {
    await database.execAsync(DEMO_V1_SCHEMA);
    await database.runAsync(
      `INSERT OR REPLACE INTO migration_journal(version, name, checksum, applied_at_utc)
       VALUES(?, ?, ?, ?)`,
      DEMO_SCHEMA_VERSION,
      'demo_v1',
      DEMO_V1_CHECKSUM,
      appliedAtUtc,
    );
    await database.execAsync(`PRAGMA user_version = ${DEMO_SCHEMA_VERSION};`);
  });
}
