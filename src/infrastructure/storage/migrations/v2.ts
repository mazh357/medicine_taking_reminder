import type { SqlDatabase } from '../database';

export const PERSONAL_SCHEMA_VERSION = 2;
export const PERSONAL_V2_CHECKSUM = 'personal-v2-2026-08-25';

export class LegacyDemoResetRequiredError extends Error {
  readonly code = 'LEGACY_DEMO_RESET_REQUIRED';

  constructor() {
    super('Legacy Demo schema v1 must be cleared before personal schema v2 is initialized.');
    this.name = 'LegacyDemoResetRequiredError';
  }
}

export const PERSONAL_V2_SCHEMA = `
CREATE TABLE IF NOT EXISTS migration_journal (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at_utc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_profile (
  id TEXT PRIMARY KEY CHECK (id='local-profile'),
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  row_version INTEGER NOT NULL CHECK (row_version > 0)
);

CREATE TABLE IF NOT EXISTS app_preferences (
  profile_id TEXT PRIMARY KEY REFERENCES app_profile(id) ON DELETE RESTRICT,
  theme_mode TEXT NOT NULL CHECK (theme_mode IN ('system','light','dark')),
  text_size TEXT NOT NULL CHECK (text_size IN ('standard','large','extra_large')),
  updated_at_utc TEXT NOT NULL,
  row_version INTEGER NOT NULL CHECK (row_version > 0)
);

CREATE TABLE IF NOT EXISTS medications (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 60),
  quantity_unit TEXT NOT NULL CHECK (quantity_unit='count'),
  status TEXT NOT NULL CHECK (status IN ('active','inactive')),
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  row_version INTEGER NOT NULL CHECK (row_version > 0)
);
CREATE INDEX IF NOT EXISTS idx_personal_medications_status_name ON medications(status, display_name);

CREATE TABLE IF NOT EXISTS regimens (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('active','paused')),
  status_effective_local_date TEXT NOT NULL,
  current_version_id TEXT NOT NULL,
  row_version INTEGER NOT NULL CHECK (row_version > 0),
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS regimen_versions (
  id TEXT PRIMARY KEY,
  regimen_id TEXT NOT NULL REFERENCES regimens(id) ON DELETE RESTRICT,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  name TEXT NOT NULL,
  local_time TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  on_time_offset_minutes INTEGER NOT NULL CHECK (on_time_offset_minutes > 0),
  record_offset_minutes INTEGER NOT NULL CHECK (record_offset_minutes > on_time_offset_minutes AND record_offset_minutes < 1440),
  capture_mode TEXT NOT NULL CHECK (capture_mode IN ('group','per_item')),
  effective_local_date TEXT NOT NULL,
  effective_to_local_date TEXT,
  superseded_at_utc TEXT,
  supersedes_version_id TEXT REFERENCES regimen_versions(id) ON DELETE RESTRICT,
  created_at_utc TEXT NOT NULL,
  UNIQUE(regimen_id, version_number)
);
CREATE INDEX IF NOT EXISTS idx_regimen_versions_effective
  ON regimen_versions(regimen_id, superseded_at_utc, effective_local_date DESC, version_number DESC);

CREATE TABLE IF NOT EXISTS regimen_version_items (
  id TEXT PRIMARY KEY,
  regimen_version_id TEXT NOT NULL REFERENCES regimen_versions(id) ON DELETE RESTRICT,
  medication_id TEXT NOT NULL REFERENCES medications(id) ON DELETE RESTRICT,
  planned_dose_quantity TEXT NOT NULL,
  quantity_unit TEXT NOT NULL CHECK (quantity_unit='count'),
  sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
  UNIQUE(regimen_version_id, medication_id)
);

CREATE TABLE IF NOT EXISTS regimen_revision_events (
  id TEXT PRIMARY KEY,
  regimen_id TEXT NOT NULL REFERENCES regimens(id) ON DELETE RESTRICT,
  revision_type TEXT NOT NULL CHECK (revision_type IN ('created','modified','paused','resumed')),
  previous_version_id TEXT REFERENCES regimen_versions(id) ON DELETE RESTRICT,
  new_version_id TEXT REFERENCES regimen_versions(id) ON DELETE RESTRICT,
  effective_local_date TEXT NOT NULL,
  replaced_occurrence_id TEXT,
  new_occurrence_id TEXT,
  recorded_at_utc TEXT NOT NULL,
  command_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_regimen_revisions_time ON regimen_revision_events(regimen_id, recorded_at_utc);

CREATE TABLE IF NOT EXISTS dose_occurrences (
  id TEXT PRIMARY KEY,
  regimen_id TEXT NOT NULL REFERENCES regimens(id) ON DELETE RESTRICT,
  regimen_version_id TEXT NOT NULL REFERENCES regimen_versions(id) ON DELETE RESTRICT,
  local_service_date TEXT NOT NULL,
  scheduled_at_utc TEXT NOT NULL,
  on_time_until_at_utc TEXT NOT NULL,
  record_until_at_utc TEXT NOT NULL,
  current_lifecycle TEXT NOT NULL CHECK (current_lifecycle IN ('scheduled','due','prepared','taken_confirmed','late_taken','missed','revoked')),
  plan_projection_state TEXT NOT NULL CHECK (plan_projection_state IN ('active','replaced')),
  replaced_by_occurrence_id TEXT,
  row_version INTEGER NOT NULL CHECK (row_version > 0),
  created_at_utc TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_occurrence_per_plan_day
  ON dose_occurrences(regimen_id, local_service_date) WHERE plan_projection_state='active';
CREATE INDEX IF NOT EXISTS idx_personal_occurrences_date ON dose_occurrences(local_service_date, scheduled_at_utc);
CREATE INDEX IF NOT EXISTS idx_personal_occurrences_reconcile ON dose_occurrences(plan_projection_state, current_lifecycle, scheduled_at_utc, record_until_at_utc);

CREATE TABLE IF NOT EXISTS dose_occurrence_items (
  id TEXT PRIMARY KEY,
  occurrence_id TEXT NOT NULL REFERENCES dose_occurrences(id) ON DELETE RESTRICT,
  regimen_version_item_id TEXT NOT NULL REFERENCES regimen_version_items(id) ON DELETE RESTRICT,
  medication_id TEXT NOT NULL REFERENCES medications(id) ON DELETE RESTRICT,
  medication_display_name TEXT NOT NULL,
  planned_dose_quantity TEXT NOT NULL,
  quantity_unit TEXT NOT NULL CHECK (quantity_unit='count'),
  sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
  UNIQUE(occurrence_id, medication_id)
);

CREATE TABLE IF NOT EXISTS dose_item_current (
  occurrence_item_id TEXT PRIMARY KEY REFERENCES dose_occurrence_items(id) ON DELETE RESTRICT,
  assertion TEXT NOT NULL CHECK (assertion IN ('pending','taken_as_planned','partially_taken','not_taken')),
  confirmed_consumption_quantity TEXT,
  active_fact_id TEXT,
  projection_version INTEGER NOT NULL CHECK (projection_version > 0)
);

CREATE TABLE IF NOT EXISTS dose_lifecycle_events (
  id TEXT PRIMARY KEY,
  occurrence_id TEXT NOT NULL REFERENCES dose_occurrences(id) ON DELETE RESTRICT,
  from_state TEXT,
  to_state TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  effective_at_utc TEXT NOT NULL,
  recorded_at_utc TEXT NOT NULL,
  command_id TEXT NOT NULL,
  UNIQUE(occurrence_id, command_id, to_state)
);

CREATE TABLE IF NOT EXISTS dose_item_missed_events (
  id TEXT PRIMARY KEY,
  occurrence_item_id TEXT NOT NULL UNIQUE REFERENCES dose_occurrence_items(id) ON DELETE RESTRICT,
  record_until_at_utc TEXT NOT NULL,
  recorded_at_utc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS photo_evidence (
  id TEXT PRIMARY KEY,
  occurrence_id TEXT NOT NULL REFERENCES dose_occurrences(id) ON DELETE RESTRICT,
  state TEXT NOT NULL CHECK (state IN ('captured','skipped_with_reason','deleted_tombstone')),
  deletion_status TEXT NOT NULL CHECK (deletion_status IN ('active','pending','deleted')),
  capture_mode TEXT NOT NULL CHECK (capture_mode IN ('group','per_item')),
  encrypted_media_id TEXT,
  skip_reason_code TEXT,
  captured_at_utc TEXT,
  deletion_requested_at_utc TEXT,
  deleted_at_utc TEXT,
  deletion_reason_code TEXT,
  created_at_utc TEXT NOT NULL,
  CHECK (
    (state='captured' AND encrypted_media_id IS NOT NULL AND captured_at_utc IS NOT NULL)
    OR (state='skipped_with_reason' AND encrypted_media_id IS NULL AND skip_reason_code IS NOT NULL)
    OR (state='deleted_tombstone' AND encrypted_media_id IS NULL AND deleted_at_utc IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_personal_photo_occurrence ON photo_evidence(occurrence_id, state, created_at_utc);

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

CREATE TABLE IF NOT EXISTS dose_item_missed_resolutions (
  id TEXT PRIMARY KEY,
  missed_event_id TEXT NOT NULL UNIQUE REFERENCES dose_item_missed_events(id) ON DELETE RESTRICT,
  assertion_fact_id TEXT NOT NULL UNIQUE REFERENCES consumption_assertion_facts(id) ON DELETE RESTRICT,
  recorded_at_utc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fact_revocations (
  id TEXT PRIMARY KEY,
  fact_id TEXT NOT NULL UNIQUE REFERENCES consumption_assertion_facts(id) ON DELETE RESTRICT,
  reason_code TEXT NOT NULL,
  revision_group_id TEXT,
  recorded_at_utc TEXT NOT NULL,
  command_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory_ledger (
  id TEXT PRIMARY KEY,
  medication_id TEXT NOT NULL REFERENCES medications(id) ON DELETE RESTRICT,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('initial','restock','consumption','reversal','manual_adjustment')),
  quantity_delta TEXT NOT NULL CHECK (quantity_delta <> '0'),
  quantity_unit TEXT NOT NULL CHECK (quantity_unit='count'),
  source_fact_type TEXT NOT NULL CHECK (source_fact_type IN ('medication','consumption_assertion','inventory_ledger','manual')),
  source_fact_id TEXT NOT NULL,
  reverses_entry_id TEXT UNIQUE REFERENCES inventory_ledger(id) ON DELETE RESTRICT,
  reason_code TEXT,
  effective_at_utc TEXT NOT NULL,
  recorded_at_utc TEXT NOT NULL,
  command_id TEXT NOT NULL,
  UNIQUE(source_fact_type, source_fact_id, entry_type)
);
CREATE INDEX IF NOT EXISTS idx_personal_inventory_medication_time ON inventory_ledger(medication_id, effective_at_utc, id);

CREATE TABLE IF NOT EXISTS reminder_intents (
  id TEXT PRIMARY KEY,
  regimen_id TEXT NOT NULL REFERENCES regimens(id) ON DELETE RESTRICT,
  occurrence_id TEXT NOT NULL UNIQUE REFERENCES dose_occurrences(id) ON DELETE RESTRICT,
  scheduled_at_utc TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  privacy_mode TEXT NOT NULL CHECK (privacy_mode='neutral'),
  status TEXT NOT NULL CHECK (status IN ('active','cancelled','completed')),
  projection_version INTEGER NOT NULL CHECK (projection_version > 0),
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reminder_intents_schedule ON reminder_intents(status, scheduled_at_utc);

CREATE TABLE IF NOT EXISTS reminder_projections (
  reminder_intent_id TEXT PRIMARY KEY REFERENCES reminder_intents(id) ON DELETE RESTRICT,
  system_notification_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending_rebuild','scheduled','failed','cancel_pending','cancelled','obsolete')),
  failure_code TEXT,
  last_reconciled_at_utc TEXT,
  row_version INTEGER NOT NULL CHECK (row_version > 0)
);

CREATE TABLE IF NOT EXISTS processed_commands (
  command_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_fingerprint TEXT NOT NULL,
  result_json TEXT NOT NULL,
  processed_at_utc TEXT NOT NULL,
  PRIMARY KEY(command_type, idempotency_key)
);
`;

export async function initializePersonalDatabaseV2(
  database: SqlDatabase,
  appliedAtUtc: string,
): Promise<void> {
  await database.execAsync('PRAGMA foreign_keys = ON;');
  await database.execAsync('PRAGMA journal_mode = WAL;');
  const current = await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const currentVersion = current?.user_version ?? 0;
  if (currentVersion === 1) throw new LegacyDemoResetRequiredError();
  if (currentVersion > PERSONAL_SCHEMA_VERSION) {
    throw new Error(`Unsupported personal schema version: ${currentVersion}`);
  }
  if (currentVersion === PERSONAL_SCHEMA_VERSION) return;

  await database.withTransactionAsync(async () => {
    await database.execAsync(PERSONAL_V2_SCHEMA);
    await database.runAsync(
      `INSERT INTO migration_journal(version,name,checksum,applied_at_utc) VALUES(?,?,?,?)`,
      PERSONAL_SCHEMA_VERSION,
      'personal_v2',
      PERSONAL_V2_CHECKSUM,
      appliedAtUtc,
    );
    await database.execAsync(`PRAGMA user_version = ${PERSONAL_SCHEMA_VERSION};`);
  });
}
