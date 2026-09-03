import type { SqlDatabase } from '../database';
import { initializePersonalDatabaseV4 } from './v4';

export const PERSONAL_SCHEMA_VERSION_V5 = 5;
export const PERSONAL_V5_SCHEMA = `
CREATE TABLE vision_samples (
  id TEXT PRIMARY KEY, label TEXT NOT NULL CHECK(length(trim(label)) BETWEEN 1 AND 40),
  created_at_utc TEXT NOT NULL, deleted_at_utc TEXT
);
CREATE TABLE vision_baselines (
  id TEXT PRIMARY KEY, sample_id TEXT NOT NULL REFERENCES vision_samples(id),
  status TEXT NOT NULL CHECK(status IN ('draft','active','retired','deleted')),
  created_at_utc TEXT NOT NULL, activated_at_utc TEXT
);
CREATE UNIQUE INDEX vision_one_active ON vision_baselines(sample_id) WHERE status='active';
CREATE INDEX vision_baseline_sample ON vision_baselines(sample_id,created_at_utc);
CREATE TABLE vision_photos (
  id TEXT PRIMARY KEY, baseline_id TEXT NOT NULL REFERENCES vision_baselines(id),
  purpose TEXT NOT NULL CHECK(purpose IN ('front','back','analysis')),
  relative_path TEXT, captured_at_utc TEXT NOT NULL, deleted_at_utc TEXT,
  validation_json TEXT, cleanup_pending INTEGER NOT NULL DEFAULT 0 CHECK(cleanup_pending IN (0,1)),
  CHECK(deleted_at_utc IS NOT NULL OR relative_path IS NOT NULL)
);
CREATE INDEX vision_photo_baseline ON vision_photos(baseline_id,purpose,captured_at_utc);
CREATE TABLE vision_analyses (
  id TEXT PRIMARY KEY, photo_id TEXT NOT NULL REFERENCES vision_photos(id),
  baseline_id TEXT NOT NULL REFERENCES vision_baselines(id),
  result_json TEXT NOT NULL, recorded_at_utc TEXT NOT NULL
);
CREATE INDEX vision_analysis_time ON vision_analyses(recorded_at_utc);
CREATE TABLE vision_annotations (
  id TEXT PRIMARY KEY, analysis_id TEXT NOT NULL REFERENCES vision_analyses(id),
  object_index INTEGER CHECK(object_index IS NULL OR object_index BETWEEN 0 AND 7),
  value TEXT NOT NULL CHECK(value IN ('looks_similar','looks_different','unable')),
  recorded_at_utc TEXT NOT NULL
);
`;

export async function initializePersonalDatabaseV5(db: SqlDatabase, now: string): Promise<void> {
  await db.execAsync('PRAGMA foreign_keys = ON;');
  await db.execAsync('PRAGMA journal_mode = WAL;');
  let version = (await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))?.user_version ?? 0;
  if (version < 4) { await initializePersonalDatabaseV4(db, now); version = 4; }
  if (version === 5) return;
  if (version !== 4) throw new Error(`Unsupported personal schema version: ${version}`);
  await db.withTransactionAsync(async () => {
    await db.execAsync(PERSONAL_V5_SCHEMA);
    await db.runAsync('INSERT INTO migration_journal(version,name,checksum,applied_at_utc) VALUES(?,?,?,?)', 5, 'personal_v5', 'visual-lab-v5-20260831', now);
    await db.execAsync('PRAGMA user_version = 5');
  });
}
